# nginx

Private TLS reverse proxy for Elasticsearch and Garage S3.

## Responsibilities

- Install NGINX and a pinned Certbot virtualenv
- Obtain and renew Let's Encrypt certificates with Certbot using Cloudflare DNS-01
- In generated mode, create a private CA and certificate for offline tests
- Terminate TLS for Elasticsearch and Garage S3
- Verify upstream TLS and routing
- Restrict port 443 to explicit private or VPN CIDRs
- Label upstream ports and TLS files for SELinux

## Required variables

```yaml
nginx_base_domain: "storage.example.com"
nginx_allowed_cidrs:
  - 10.20.0.0/16
```

For `nginx_certificate_mode: letsencrypt`:

```yaml
nginx_letsencrypt_email: "ops@example.com"
nginx_cloudflare_api_token: "{{ secret_nginx_cloudflare_api_token }}"
```

For offline development:

```yaml
nginx_certificate_mode: generated
```

## Hostnames

- `es.<nginx_base_domain>` → `https://127.0.0.1:9200`
- `s3.<nginx_base_domain>` → `http://127.0.0.1:3900`

The S3 endpoint uses path-style access. PostgreSQL and MariaDB are not HTTP services and are not proxied.

## Certificates

- `letsencrypt`: Certbot DNS-01 through Cloudflare. No inbound HTTP challenge is required.
- `generated`: local CA and certificate under `/etc/nginx/tls`, used by development and CI.
- Renewal runs twice daily through `certbot-renew.timer`.
- The deploy hook copies certificates into `/etc/nginx/tls` and reloads NGINX.

## Security notes

- NGINX is not publicly exposed. `nginx_allowed_cidrs` must contain private or VPN networks and cannot contain `0.0.0.0/0` or `::/0`.
- Only port 443 is opened.
- Access logs omit query strings.
- Elasticsearch upstream TLS is verified with the Elasticsearch CA.
- S3 clients must use path-style addressing; the Host header is preserved.

## SELinux

The role labels `/etc/nginx/tls` as `httpd_config_t` and the upstream ports as `http_port_t` so the `httpd_t` domain can read certificates and connect to Elasticsearch/Garage. A real-host verification is required.
