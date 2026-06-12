# Reel bot backend — needs FFmpeg (video) + fonts (SVG text) which the plain
# Render Node runtime lacks, so we run it as a container.
FROM node:20-slim

# ffmpeg/ffprobe for the reel engine; liberation fonts ≈ Arial for SVG text.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fontconfig fonts-liberation \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# Map the SVG font names (Arial / Arial Black) to the installed Liberation fonts.
RUN printf '%s\n' \
  '<?xml version="1.0"?>' \
  '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
  '<fontconfig>' \
  '  <alias><family>Arial</family><prefer><family>Liberation Sans</family></prefer></alias>' \
  '  <alias><family>Arial Black</family><prefer><family>Liberation Sans</family></prefer></alias>' \
  '</fontconfig>' > /etc/fonts/local.conf

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN chmod +x docker-entrypoint.sh

# Render injects PORT; the app reads process.env.PORT.
ENTRYPOINT ["./docker-entrypoint.sh"]
