FROM golang:1.25-alpine AS build
WORKDIR /src
COPY proto/ ./proto/
COPY agent-linux/ ./agent-linux/
RUN go work init ./proto ./agent-linux && go work edit -replace=github.com/Wearden/proto@v0.0.0=./proto
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /out/wearden-agent ./agent-linux/cmd/agent
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/wearden-agent /usr/local/bin/wearden-agent
COPY agent-linux/LICENSE agent-linux/THIRD_PARTY_NOTICES.md /usr/share/licenses/wearden/
ENTRYPOINT ["/usr/local/bin/wearden-agent"]
