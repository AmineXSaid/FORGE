/**
 * The endpoint diagnostics ladder.
 *
 * Rungs run in order and each emits as it finishes, so the panel fills in
 * progressively rather than sitting blank for thirty seconds. The order is the
 * point: it walks outward from the machine to the model, so the *first* failure
 * is the real one. Without it, a bad API key and a wrong port and an expired
 * certificate all present identically as "the endpoint did not answer".
 *
 *   Profile → Certificates → DNS → TCP → TLS → Authentication
 *           → Completion → Streaming
 *
 * Every failed rung carries a `fix`, because a diagnosis nobody can act on is
 * just a nicer-looking error message.
 */
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { EndpointProfile } from '../endpoints/profile';
import { buildTlsMaterial, buildTransport, resolveProxy } from '../endpoints/transport';
import { applyAuth } from '../endpoints/auth';
import { probeComplete, ProbeError } from '../endpoints/probeClient';

export type RungStatus = 'pass' | 'fail' | 'warn' | 'skipped';

export interface Rung {
  name: string;
  status: RungStatus;
  detail: string;
  /** What to do about it, when it failed. */
  fix?: string;
  ms: number;
}

/**
 * Local TLS-inspecting software, recognised from the root it re-signs with.
 *
 * Far beyond a cosmetic label. Antivirus and corporate inspection proxies
 * terminate TLS and re-emit it, and several buffer a response until it is
 * complete instead of forwarding as it arrives. The visible symptom is a
 * request that works in curl (short, GET) and stalls in the extension
 * (long-lived POST, or SSE), which reads as "the endpoint is down" when the
 * endpoint is fine. Naming the culprit is the difference between editing a
 * profile that was never wrong and adding an exclusion.
 */
const INSPECTORS: [RegExp, string][] = [
  [/avast/i, 'Avast Web/Mail Shield'],
  [/avg\b/i, 'AVG Web Shield'],
  [/kaspersky/i, 'Kaspersky'],
  [/eset/i, 'ESET SSL filtering'],
  [/bitdefender/i, 'Bitdefender'],
  [/dr\.?web/i, 'Dr.Web'],
  [/sophos/i, 'Sophos'],
  [/zscaler/i, 'Zscaler'],
  [/fortinet|fortigate/i, 'FortiGate'],
  [/bluecoat|blue coat|symantec web/i, 'Blue Coat'],
  [/mcafee/i, 'McAfee Web Gateway'],
  [/palo alto|paloalto/i, 'Palo Alto'],
  [/netskope/i, 'Netskope'],
  [/charles proxy|fiddler|mitmproxy|burp/i, 'a local debugging proxy'],
];

export function inspectorIn(chain: string[]): string | undefined {
  for (const name of chain) {
    for (const [re, label] of INSPECTORS) if (re.test(name)) return label;
  }
  return undefined;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T | undefined, any, number]> {
  const t0 = Date.now();
  try {
    return [await fn(), undefined, Date.now() - t0];
  } catch (e) {
    return [undefined, e, Date.now() - t0];
  }
}

export interface LadderOptions {
  profile: EndpointProfile;
  secrets: (key: string) => string | undefined;
  /** Fires per rung, so the panel can fill in live. */
  emit?: (rung: Rung) => void;
  signal?: AbortSignal;
}

export async function runLadder(options: LadderOptions): Promise<Rung[]> {
  const { profile, secrets, emit, signal } = options;
  const rungs: Rung[] = [];
  const push = (rung: Rung): Rung => {
    rungs.push(rung);
    emit?.(rung);
    return rung;
  };

  // ── Profile ────────────────────────────────────────────────────────────
  let url: URL;
  try {
    url = new URL(profile.baseUrl);
    push({
      name: 'Profile',
      status: 'pass',
      detail: `${profile.name}: ${profile.wire} wire to ${url.origin}, model "${profile.model}".`,
      ms: 0,
    });
  } catch {
    push({
      name: 'Profile',
      status: 'fail',
      detail: `baseUrl "${profile.baseUrl}" is not a URL.`,
      fix: 'Set baseUrl to an origin such as https://gateway.example/v1.',
      ms: 0,
    });
    return rungs;
  }

  const isTls = url.protocol === 'https:';
  const port = Number(url.port) || (isTls ? 443 : 80);

  // ── Certificates and keys ──────────────────────────────────────────────
  {
    const [material, err, ms] = await timed(async () => buildTlsMaterial(profile.tls));
    if (err) {
      push({
        name: 'Certificates and keys',
        status: 'fail',
        detail: String(err?.message ?? err),
        fix: 'Check the paths in tls.caBundle, tls.cert, tls.key and tls.pfx, and that this user can read them.',
        ms,
      });
      return rungs;
    }
    const bits: string[] = [];
    if (material?.ca?.length) bits.push(`${material.ca.length} extra CA certificate(s)`);
    if (material?.cert) bits.push('a client certificate');
    if (material?.pfx) bits.push('a PKCS#12 bundle');
    if (profile.tls?.insecureSkipVerify) {
      push({
        name: 'Certificates and keys',
        status: 'warn',
        detail: 'insecureSkipVerify is on: certificates are not verified.',
        fix: 'Add the endpoint CA to tls.caBundle and turn insecureSkipVerify off.',
        ms,
      });
    } else {
      push({
        name: 'Certificates and keys',
        status: 'pass',
        detail: bits.length ? `Loaded ${bits.join(', ')}.` : 'No custom TLS material; using the system trust store.',
        ms,
      });
    }
  }

  // ── DNS ────────────────────────────────────────────────────────────────
  const proxy = resolveProxy(profile);
  if (proxy) {
    push({
      name: 'DNS',
      status: 'skipped',
      detail: `A proxy is configured (${proxy}), so the proxy resolves the host, not this machine.`,
      ms: 0,
    });
  } else if (net.isIP(url.hostname)) {
    push({ name: 'DNS', status: 'skipped', detail: `${url.hostname} is already an IP address.`, ms: 0 });
  } else {
    const [addresses, err, ms] = await timed(() => dns.lookup(url.hostname, { all: true }));
    if (err) {
      push({
        name: 'DNS',
        status: 'fail',
        detail: `${url.hostname} did not resolve: ${err.code ?? err.message}`,
        fix: err.code === 'ENOTFOUND'
          ? 'Check the host name in baseUrl. On a corporate network the name may only resolve over VPN.'
          : 'Check this machine\'s DNS configuration.',
        ms,
      });
      return rungs;
    }
    push({
      name: 'DNS',
      status: 'pass',
      detail: `${url.hostname} → ${(addresses ?? []).map((a) => a.address).join(', ')}`,
      ms,
    });
  }

  // ── TCP ────────────────────────────────────────────────────────────────
  if (proxy) {
    push({
      name: 'TCP',
      status: 'skipped',
      detail: 'A proxy is configured, so the connection is made by the proxy.',
      ms: 0,
    });
  } else {
    const [, err, ms] = await timed(() => new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host: url.hostname, port });
      const done = (e?: Error): void => {
        socket.destroy();
        e ? reject(e) : resolve();
      };
      socket.setTimeout(10_000, () => done(new Error('timed out after 10s')));
      socket.once('connect', () => done());
      socket.once('error', done);
    }));
    if (err) {
      push({
        name: 'TCP',
        status: 'fail',
        detail: `Could not open a socket to ${url.hostname}:${port} — ${err.code ?? err.message}`,
        fix: err.code === 'ECONNREFUSED'
          ? `Nothing is listening on port ${port}. Check the port in baseUrl and that the server is running.`
          : 'Check a firewall or VPN between this machine and the endpoint.',
        ms,
      });
      return rungs;
    }
    push({ name: 'TCP', status: 'pass', detail: `Connected to ${url.hostname}:${port}.`, ms });
  }

  // ── TLS handshake ──────────────────────────────────────────────────────
  if (!isTls) {
    push({ name: 'TLS handshake', status: 'skipped', detail: 'baseUrl is http://, so there is no TLS.', ms: 0 });
  } else if (proxy) {
    push({ name: 'TLS handshake', status: 'skipped', detail: 'A proxy is configured; TLS is negotiated through it.', ms: 0 });
  } else {
    const material = buildTlsMaterial(profile.tls);
    const [info, err, ms] = await timed(() => new Promise<{ chain: string[]; protocol: string }>((resolve, reject) => {
      const socket = tls.connect({
        host: url.hostname,
        port,
        servername: profile.tls?.servername ?? url.hostname,
        ca: material.ca,
        cert: material.cert,
        key: material.key,
        passphrase: material.passphrase,
        pfx: material.pfx,
        minVersion: profile.tls?.minVersion,
        rejectUnauthorized: !profile.tls?.insecureSkipVerify,
      });
      socket.setTimeout(15_000, () => {
        socket.destroy();
        reject(new Error('the TLS handshake timed out after 15s'));
      });
      socket.once('secureConnect', () => {
        const chain: string[] = [];
        let cert: tls.DetailedPeerCertificate | undefined = socket.getPeerCertificate(true);
        const seen = new Set<string>();
        while (cert && cert.subject && !seen.has(cert.fingerprint)) {
          seen.add(cert.fingerprint);
          chain.push(String(cert.issuer?.O ?? cert.issuer?.CN ?? ''));
          cert = cert.issuerCertificate as tls.DetailedPeerCertificate;
        }
        const protocol = socket.getProtocol() ?? 'unknown';
        socket.destroy();
        resolve({ chain, protocol });
      });
      socket.once('error', (e) => {
        socket.destroy();
        reject(e);
      });
    }));

    if (err) {
      const code = err.code as string | undefined;
      push({
        name: 'TLS handshake',
        status: 'fail',
        detail: `${code ?? 'handshake failed'}: ${err.message}`,
        fix: code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
          ? 'The issuing CA is not trusted here. Add it to tls.caBundle, or set tls.caBundle to "system" to use the OS store.'
          : code === 'CERT_HAS_EXPIRED'
            ? 'The endpoint certificate has expired. That is a server-side fix.'
            : code === 'ERR_TLS_CERT_ALTNAME_INVALID'
              ? 'The certificate does not cover this host name. Set tls.servername if the gateway expects a different SNI.'
              : 'Check tls.minVersion and whether the endpoint requires a client certificate.',
        ms,
      });
      return rungs;
    }

    const inspector = info ? inspectorIn(info.chain) : undefined;
    push({
      name: 'TLS handshake',
      status: inspector ? 'warn' : 'pass',
      detail: inspector
        ? `${info!.protocol}, but the certificate was re-signed by ${inspector}.`
        : `${info!.protocol} with ${info!.chain.filter(Boolean)[0] || 'an unnamed issuer'}.`,
      fix: inspector
        ? `${inspector} is terminating TLS. Several such products buffer a response instead of ` +
          'forwarding it as it arrives, which stalls streaming while short requests still work. ' +
          'If turns hang, add an exclusion for this host.'
        : undefined,
      ms,
    });
  }

  // ── Authentication ─────────────────────────────────────────────────────
  const built = buildTransport(profile);
  let headers: Record<string, string> = {};
  {
    const [applied, err, ms] = await timed(() => applyAuth(profile, built.dispatcher, secrets));
    if (err) {
      push({
        name: 'Authentication',
        status: 'fail',
        detail: String(err?.message ?? err),
        fix: profile.auth?.kind === 'exchange'
          ? 'The token exchange failed. Check auth.exchange.url, its body, and tokenPath.'
          : profile.auth?.kind === 'exec'
            ? 'The token command failed. Check auth.exec.command runs in this environment.'
            : 'Check that the ${env:...} or ${secret:...} reference in auth.value resolves here.',
        ms,
      });
      return rungs;
    }
    headers = applied!.headers;
    const names = Object.keys(headers);
    push({
      name: 'Authentication',
      status: profile.auth?.kind === 'none' ? 'warn' : 'pass',
      detail: profile.auth?.kind === 'none'
        ? 'No credential is configured for this endpoint.'
        : `Resolved a ${profile.auth?.kind} credential into ${names.join(', ') || 'no header'}.`,
      ms,
    });
  }

  // ── Completion ─────────────────────────────────────────────────────────
  {
    const [out, err, ms] = await timed(() => probeComplete(
      profile,
      built.dispatcher,
      headers,
      {
        model: profile.model,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Reply with the single word: ready.' }],
      },
      signal,
    ));
    if (err) {
      const status = err instanceof ProbeError ? err.status : undefined;
      push({
        name: 'Completion',
        status: 'fail',
        detail: status ? `HTTP ${status}: ${err.message}` : String(err?.message ?? err),
        fix: status === 401 || status === 403
          ? 'The credential was rejected. Check the key itself, and whether this gateway wants it in a different header.'
          : status === 404
            ? `The route was not found. Check baseUrl and chatPath — this request went to ${profile.baseUrl}.`
            : status === 400
              ? `The endpoint rejected the request. Often the model id: "${profile.model}" may not be servable here. Run Forge: List Endpoint Models.`
              : 'Check the model id and the endpoint logs.',
        ms,
      });
      return rungs;
    }
    push({
      name: 'Completion',
      status: 'pass',
      detail: `Answered in ${ms}ms: "${(out?.text ?? '').trim().slice(0, 60)}" ` +
        `(${out?.usage.input ?? 0} in, ${out?.usage.output ?? 0} out).`,
      ms,
    });
  }

  // ── Streaming ──────────────────────────────────────────────────────────
  if (!profile.capabilities.streaming) {
    push({
      name: 'Streaming',
      status: 'skipped',
      detail: 'Disabled in this profile (capabilities.streaming is false).',
      ms: 0,
    });
  } else {
    const [out, err, ms] = await timed(() => probeComplete(
      profile,
      built.dispatcher,
      headers,
      {
        model: profile.model,
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Count from one to eight, one word per line.' }],
      },
      signal,
    ));
    if (err) {
      push({
        name: 'Streaming',
        status: 'fail',
        detail: String(err?.message ?? err),
        fix: 'The endpoint completes but will not stream. Set capabilities.streaming to false to stop Forge asking.',
        ms,
      });
    } else if ((out?.chunks ?? 0) > 1) {
      push({
        name: 'Streaming',
        status: 'pass',
        detail: `${out!.chunks} incremental chunks in ${ms}ms.`,
        ms,
      });
    } else {
      push({
        name: 'Streaming',
        status: 'warn',
        detail: 'The whole answer arrived in one frame, so nothing is gained by streaming.',
        fix: 'A TLS-inspecting proxy often causes this. If there is none, the gateway is buffering.',
        ms,
      });
    }
  }

  return rungs;
}

/** Turn the rung list into the one sentence a banner can show. */
export function summarise(rungs: Rung[]): { ok: boolean; summary: string } {
  const failed = rungs.find((r) => r.status === 'fail');
  if (failed) return { ok: false, summary: `${failed.name} failed: ${failed.detail}` };
  const warned = rungs.filter((r) => r.status === 'warn');
  if (warned.length) {
    return { ok: true, summary: `Working, with ${warned.length} warning(s): ${warned[0].detail}` };
  }
  return { ok: true, summary: 'All checks passed.' };
}
