# API Node para o lab de benchmark (R06 - rede degradada, L04=B).
# Executa a mesma API Express sem alterar o codigo; apenas empacota para rodar
# em container na rede Docker de teste, com iproute2 (tc) para aplicar netem.
FROM node:20-alpine

# iproute2 fornece o comando `tc` usado pelos scripts de netem (benchmarks/netem).
RUN apk add --no-cache iproute2

WORKDIR /app

# Instala dependencias (inclui devDependencies: tsx roda o TypeScript direto).
COPY package.json ./
RUN npm install --include=dev --no-audit --no-fund

# Codigo-fonte da API.
COPY tsconfig.json ./
COPY src ./src

# Padroes do lab: porta 3000 e rate limiter desabilitado para benchmarks.
ENV PORT=3000 \
    BENCHMARK_MODE=true \
    NODE_ENV=production

EXPOSE 3000

CMD ["npx", "tsx", "src/server.ts"]
