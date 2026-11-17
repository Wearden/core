FROM golang:1.25-alpine AS build
WORKDIR /src
COPY proto/ ./proto/
COPY core/go.mod core/go.sum ./core/
RUN go work init ./proto ./core && go work edit -replace=github.com/Wearden/proto@v0.0.0=./proto && go work sync
COPY core/cmd/ ./core/cmd/
COPY core/internal/ ./core/internal/
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /out/wearden-core ./core/cmd/core
FROM alpine:3.22
RUN apk add --no-cache ca-certificates guacamole-server-encoder ffmpeg && addgroup -S -g 101 wearden && adduser -S -u 100 -G wearden wearden
COPY --from=build /out/wearden-core /usr/local/bin/wearden-core
COPY core/LICENSE core/THIRD_PARTY_NOTICES.md /usr/share/licenses/wearden/
USER wearden
WORKDIR /app
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/wearden-core"]
