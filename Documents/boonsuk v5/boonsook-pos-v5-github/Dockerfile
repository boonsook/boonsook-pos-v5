# ═══════════════════════════════════════════════════
# Boonsook POS PRO V5 — Docker Image
# Lightweight Nginx server for static PWA
# ═══════════════════════════════════════════════════
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy app files
COPY . /usr/share/nginx/html/

# Remove Docker/CI files from served content
RUN rm -f /usr/share/nginx/html/Dockerfile \
          /usr/share/nginx/html/docker-compose.yml \
          /usr/share/nginx/html/nginx.conf \
          /usr/share/nginx/html/.dockerignore \
          /usr/share/nginx/html/README.md \
          /usr/share/nginx/html/DOCUMENTATION.md \
          /usr/share/nginx/html/test-suite.js

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
