package app

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// RDP certificate pinning. Windows hosts usually present a self-signed RDP
// certificate, which guacd rejects. guacd 1.5.5 cannot pin a fingerprint, so core
// reads the certificate itself, the operator confirms its SHA-256 fingerprint once
// (trust on first use, like the SSH host key), and a session is opened only while
// the host still presents that exact certificate. Only then is guacd told to skip
// its own CA check.
const rdpCertsCollection = "rdp_certificates"

type rdpCertificate struct {
	Fingerprint string `json:"fingerprint"`
	Subject     string `json:"subject"`
	NotAfter    string `json:"not_after"`
}

// X.224 Connection Request carrying an RDP negotiation request for TLS or CredSSP.
var rdpNegotiationRequest = []byte{0x03, 0x00, 0x00, 0x13, 0x0e, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00, 0x03, 0x00, 0x00, 0x00}

func rdpFingerprint(raw []byte) string {
	sum := sha256.Sum256(raw)
	parts := make([]string, len(sum))
	for i, b := range sum {
		parts[i] = strings.ToUpper(hex.EncodeToString([]byte{b}))
	}
	return strings.Join(parts, ":")
}

// rdpProbeCertificate negotiates TLS with an RDP server and returns its leaf certificate.
func rdpProbeCertificate(ctx context.Context, addr string) (rdpCertificate, error) {
	var out rdpCertificate
	d := net.Dialer{Timeout: 8 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return out, errors.New("cannot reach the RDP port")
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err = conn.Write(rdpNegotiationRequest); err != nil {
		return out, errors.New("RDP negotiation failed")
	}
	header := make([]byte, 4)
	if _, err = io.ReadFull(conn, header); err != nil || header[0] != 0x03 {
		return out, errors.New("the port does not speak RDP")
	}
	size := int(binary.BigEndian.Uint16(header[2:4]))
	if size < 11 || size > 512 {
		return out, errors.New("unexpected RDP negotiation response")
	}
	body := make([]byte, size-4)
	if _, err = io.ReadFull(conn, body); err != nil {
		return out, errors.New("unexpected RDP negotiation response")
	}
	// body: X.224 Connection Confirm (7 bytes) followed by an RDP_NEG_RSP or RDP_NEG_FAILURE.
	if len(body) >= 15 {
		switch body[7] {
		case 0x03:
			return out, errors.New("the RDP server refused TLS; enable TLS or Network Level Authentication on the host")
		case 0x02:
			if binary.LittleEndian.Uint32(body[11:15])&0x3 == 0 {
				return out, errors.New("the RDP server only offers legacy RDP security")
			}
		}
	} else {
		return out, errors.New("the RDP server only offers legacy RDP security")
	}
	// Verification happens against the operator confirmed fingerprint, not a CA.
	client := tls.Client(conn, &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12})
	if err = client.HandshakeContext(ctx); err != nil {
		return out, errors.New("TLS handshake with the RDP server failed")
	}
	certs := client.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return out, errors.New("the RDP server presented no certificate")
	}
	out.Fingerprint = rdpFingerprint(certs[0].Raw)
	out.Subject = certs[0].Subject.String()
	out.NotAfter = certs[0].NotAfter.UTC().Format(time.RFC3339)
	return out, nil
}

func rdpAddress(asset map[string]any) (string, bool) {
	port := integer(asset["rdp_port"])
	if port < 1 || port > 65535 {
		return "", false
	}
	return net.JoinHostPort(text(asset["host"]), strconv.FormatInt(port, 10)), true
}

func (s *Server) rdpPinned(ctx context.Context, assetID int64, addr string) string {
	doc, err := s.Store.Get(ctx, rdpCertsCollection, strconv.FormatInt(assetID, 10))
	if err != nil || text(doc["address"]) != addr {
		return ""
	}
	return text(doc["fingerprint"])
}

// GET /api/assets/{id}/rdp-certificate shows what the host presents and whether it is trusted.
func (s *Server) rdpCertificateInfo(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		problem(w, 400, "Invalid asset id")
		return
	}
	asset, err := s.asset(r.Context(), id)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	if text(asset["os_type"]) != "windows" {
		problem(w, 400, "RDP certificates apply to Windows assets only")
		return
	}
	addr, ok := rdpAddress(asset)
	if !ok {
		problem(w, 400, "RDP is disabled for this asset")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	cert, err := rdpProbeCertificate(ctx, addr)
	if err != nil {
		problem(w, 502, err.Error())
		return
	}
	pinned := s.rdpPinned(ctx, id, addr)
	writeJSON(w, 200, map[string]any{"fingerprint": cert.Fingerprint, "subject": cert.Subject, "not_after": cert.NotAfter, "trusted": pinned == cert.Fingerprint, "changed": pinned != "" && pinned != cert.Fingerprint})
}

// rdpVerify checks the presented certificate against the pin. A confirmed fingerprint
// from the operator replaces a missing or changed pin, and only if it matches what the
// host presents right now.
func (s *Server) rdpVerify(r *http.Request, assetID int64, addr, confirmed string) error {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	cert, err := rdpProbeCertificate(ctx, addr)
	if err != nil {
		return err
	}
	pinned := s.rdpPinned(ctx, assetID, addr)
	if pinned == cert.Fingerprint {
		return nil
	}
	if confirmed == "" || confirmed != cert.Fingerprint {
		if pinned != "" {
			s.audit(r, "session.rdp_certificate_changed", strconv.FormatInt(assetID, 10), false, cert.Fingerprint)
			return errors.New("the RDP certificate of this host changed; confirm the new certificate first")
		}
		return errors.New("confirm the RDP certificate of this host first")
	}
	doc := map[string]any{"address": addr, "fingerprint": cert.Fingerprint, "subject": cert.Subject, "not_after": cert.NotAfter, "confirmed_by": current(r).Username, "confirmed_at": now()}
	if err := s.Store.Put(ctx, rdpCertsCollection, strconv.FormatInt(assetID, 10), doc); err != nil {
		return errors.New("cannot store the confirmed certificate")
	}
	s.audit(r, "session.rdp_certificate_confirmed", strconv.FormatInt(assetID, 10), true, cert.Fingerprint)
	return nil
}
