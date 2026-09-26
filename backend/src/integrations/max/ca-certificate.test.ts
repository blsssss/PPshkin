import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backendDir = new URL('../../../', import.meta.url);
const CERTIFICATE_PATH = 'certs/russian_trusted_root_ca.pem';

describe('Russian Trusted Root CA', () => {
  const certificate = new X509Certificate(readFileSync(new URL(CERTIFICATE_PATH, backendDir)));

  it('is the root certificate of the Ministry of Digital Development', () => {
    expect(certificate.subject).toBe(
      'C=RU\nO=The Ministry of Digital Development and Communications\nCN=Russian Trusted Root CA',
    );
    expect(certificate.issuer).toBe(certificate.subject);
    expect(certificate.ca).toBe(true);
    expect(certificate.fingerprint256).toBe(
      'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31',
    );
    expect(new Date(certificate.validTo).toISOString()).toBe('2032-02-27T21:04:15.000Z');
  });

  it('is trusted by the runtime image', () => {
    const dockerfile = readFileSync(new URL('Dockerfile', backendDir), 'utf8');
    const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
    expect(runtime).toContain('COPY certs ./certs');
    expect(runtime).toContain(`ENV NODE_EXTRA_CA_CERTS=/app/${CERTIFICATE_PATH}`);
  });
});
