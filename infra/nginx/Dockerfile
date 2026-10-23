FROM nginx:mainline-alpine

# openssl: gera certificados self-signed no entrypoint.
# iproute2: fornece `tc` para aplicar netem (benchmarks/netem, R06/L04=B).
RUN apk add --no-cache openssl iproute2

COPY infra/nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
