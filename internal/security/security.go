package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/argon2"
	"strings"
)

func Random() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func ID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func Digest(s string) string { sum := sha256.Sum256([]byte(s)); return hex.EncodeToString(sum[:]) }
func HashPassword(password string) (string, error) {
	if len(password) < 12 || len(password) > 256 {
		return "", errors.New("password must contain 12..256 bytes")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return "$argon2id$v=19$m=65536,t=3,p=2$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(key), nil
}
func VerifyPassword(password, encoded string) bool {
	if len(password) > 256 {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=65536,t=3,p=2" {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) != 16 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) != 32 {
		return false
	}
	key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return subtle.ConstantTimeCompare(key, expected) == 1
}
func key(raw string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(b) != 32 {
		return nil, errors.New("WEARDEN_VAULT_KEY must be base64 of 32 random bytes")
	}
	return b, nil
}
func Seal(raw string, plaintext []byte) ([]byte, error) {
	k, err := key(raw)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, []byte("wearden-vault-v1")), nil
}
func Open(raw string, data []byte) ([]byte, error) {
	k, err := key(raw)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize() {
		return nil, errors.New("invalid encrypted credential")
	}
	return gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], []byte("wearden-vault-v1"))
}

// GuacamoleToken preserves the existing guacamole-lite encrypted envelope. It is not the credential-vault format.
func GuacamoleToken(raw string, connection any) (string, error) {
	if len(raw) != 32 {
		return "", errors.New("GUAC_CRYPT_KEY must be exactly 32 bytes")
	}
	plain, err := json.Marshal(map[string]any{"connection": connection})
	if err != nil {
		return "", err
	}
	pad := aes.BlockSize - len(plain)%aes.BlockSize
	for range pad {
		plain = append(plain, byte(pad))
	}
	block, err := aes.NewCipher([]byte(raw))
	if err != nil {
		return "", err
	}
	iv := make([]byte, aes.BlockSize)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	encrypted := make([]byte, len(plain))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(encrypted, plain)
	envelope, err := json.Marshal(map[string]string{"iv": base64.StdEncoding.EncodeToString(iv), "value": base64.StdEncoding.EncodeToString(encrypted)})
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(envelope), nil
}

// DerivedAgentToken makes an enrollment retry reproducible without storing an
// issued plaintext agent credential. The single-use enrollment secret is a
// high-entropy PRF key; domain separation binds the request and agent identity.
func DerivedAgentToken(enrollmentToken, requestID, agentID string) string {
	mac := hmac.New(sha256.New, []byte(enrollmentToken))
	mac.Write([]byte("wearden-agent-enrollment-v1\x00" + requestID + "\x00" + agentID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
