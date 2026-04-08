FROM node:18-alpine

# Install nginx and supervisord
RUN apk add --no-cache nginx supervisor

# Create required log directories
RUN mkdir -p /var/log/supervisor /var/log/nginx /app/api /app/html /app/db

# Copy package.json and install dependencies in the image
COPY api/package.json /tmp/package.json
RUN cd /tmp && npm install --prefix /tmp

# Set working directory
WORKDIR /app

# Copy node_modules from /tmp to /app/api
RUN cp -r /tmp/node_modules /app/api/

# Copy API server code
COPY api/server.js /app/api/server.js

# Copy HTML frontend
COPY html /app/html

# Configure nginx
RUN mkdir -p /etc/nginx/conf.d
COPY nginx.conf /etc/nginx/nginx.conf

# Configure supervisord
RUN mkdir -p /etc/supervisor/conf.d
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create db directory
RUN chmod 777 /app/db

EXPOSE 80 3001

# Start supervisord to manage both services
CMD exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
