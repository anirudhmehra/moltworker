FROM docker.io/cloudflare/sandbox:0.9.2

# Install Node.js 22 (required by OpenClaw).
# Pin to 22.17.1 because newer Node/npm combinations were flaky when
# installing cooled OpenClaw builds inside the sandbox base image.
ENV NODE_VERSION=22.17.1
RUN ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
         amd64) NODE_ARCH="x64" ;; \
         arm64) NODE_ARCH="arm64" ;; \
         *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
       esac \
    && apt-get update && apt-get install -y xz-utils ca-certificates \
    && curl -fsSLk https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version \
    && npm --version

# Install OpenClaw.
# Pin to a cooled version that supports OpenCode Go auth.
RUN cd /tmp \
    && npm install -g openclaw@2026.4.27 \
    && openclaw --version

# Use /home/openclaw as the home directory instead of /root.
# The Sandbox SDK backup API only allows directories under /home, /workspace,
# /tmp, or /var/tmp — not /root.
ENV HOME=/home/openclaw
RUN mkdir -p /home/openclaw/.openclaw \
    && mkdir -p /home/openclaw/clawd \
    && mkdir -p /home/openclaw/clawd/skills \
    && ln -s /home/openclaw/.openclaw /root/.openclaw \
    && ln -s /home/openclaw/clawd /root/clawd

# Copy startup script
# Build cache bust: 2026-05-03-synced-fork-opencode-go
ENV START_OPENCLAW_CACHE_BUST=2026-05-03-synced-fork-opencode-go
COPY start-openclaw.sh /usr/local/bin/start-openclaw.sh
RUN chmod +x /usr/local/bin/start-openclaw.sh

# Copy custom skills
COPY skills/ /home/openclaw/clawd/skills/

# Ensure all files are readable for mksquashfs (Sandbox SDK backup).
RUN chmod -R a+rX /home/openclaw

# Set working directory
WORKDIR /home/openclaw/clawd

# Expose the gateway port
EXPOSE 18789
