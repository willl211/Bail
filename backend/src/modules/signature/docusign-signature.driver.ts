import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, createPrivateKey, sign, timingSafeEqual } from 'node:crypto';
import type { SignatureDriver, SignatureEnvelope, SignatureEnvelopeInput, SignatureEvent, SignatureSigner } from './signature.driver';
import { validateSignatureEvent } from './signature-event.validation';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';

/** REST v2.1 + JWT, exclusivement contre le compte développeur DocuSign. */
@Injectable()
export class DocusignSignatureDriver implements SignatureDriver {
  readonly name = 'docusign';
  private readonly base: string;
  private readonly account: string;
  private readonly integration: string;
  private readonly user: string;
  private readonly key: ReturnType<typeof createPrivateKey>;
  private readonly hmac: string;
  private token: { value: string; until: number } | null = null;
  private obtaining: Promise<string> | null = null;

  constructor(config: ConfigService) {
    const get = (key: string) => config.get<string>(`integrations.signature.docusign.${key}`, '');
    this.base = get('baseUrl').replace(/\/$/, '');
    if (this.base !== 'https://demo.docusign.net/restapi') throw new Error('DocuSign exige https://demo.docusign.net/restapi pendant le développement.');
    this.account = get('accountId'); this.integration = get('integrationKey'); this.user = get('userId'); this.hmac = get('hmacSecret');
    if (![this.account, this.integration, this.user, this.hmac, get('privateKey')].every(Boolean)) throw new Error('Configuration DocuSign sandbox incomplète (compte, intégration, utilisateur, clé RSA et HMAC).');
    this.key = createPrivateKey(get('privateKey').replace(/\\n/g, '\n'));
    if (this.key.asymmetricKeyType !== 'rsa') throw new Error('Une clé RSA est nécessaire pour DocuSign.');
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    if (this.obtaining) return this.obtaining;
    this.obtaining = (async () => {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const iat = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: this.integration, sub: this.user, aud: 'account-d.docusign.com', iat, exp: iat + 3600, scope: 'signature impersonation' })}`;
      const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), this.key).toString('base64url')}`;
      let response: Response;
      try { response = await fetch('https://account-d.docusign.com/oauth/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      }); } catch { throw new ServiceUnavailableException('Authentification DocuSign indisponible.'); }
      if (!response.ok) throw new ServiceUnavailableException('Authentification DocuSign refusée. Vérifiez les clés et le consentement JWT.');
      const body = object(await response.json());
      if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number' || body.expires_in < 120) throw new ServiceUnavailableException('Réponse OAuth DocuSign invalide.');
      this.token = { value: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000 };
      return this.token.value;
    })();
    try { return await this.obtaining; } finally { this.obtaining = null; }
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const token = await this.accessToken();
    let response: Response;
    try { response = await fetch(`${this.base}/v2.1/accounts/${encodeURIComponent(this.account)}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }); } catch { throw new ServiceUnavailableException('DocuSign injoignable. La tentative est conservée pour reprise.'); }
    if (response.status === 401) this.token = null;
    return response;
  }

  private async json(path: string, method = 'GET', body?: unknown): Promise<Json> {
    const response = await this.request(path, method, body);
    if (!response.ok) throw new ServiceUnavailableException(`DocuSign a refusé la requête (${response.status}). La tentative est conservée.`);
    return object(await response.json());
  }

  async createEnvelope(input: SignatureEnvelopeInput): Promise<SignatureEnvelope> {
    if (!input.transactionId || !input.requestedAt || input.document.mimeType !== 'application/pdf' || !input.document.signaturePage || input.signers.length !== 2) throw new BadRequestException('Enveloppe DocuSign incomplète.');
    const requested = Date.parse(input.requestedAt);
    if (!Number.isFinite(requested) || Date.now() - requested > 6 * 86400_000) throw new ConflictException('Tentative ancienne : rapprochement DocuSign requis avant tout nouvel envoi.');
    if (createHash('sha256').update(input.document.content).digest('hex') !== input.checksum) throw new BadRequestException('Empreinte du bail incohérente.');
    const lookup = async () => {
      const result = await this.json(`/envelopes?transaction_ids=${encodeURIComponent(input.transactionId!)}&from_date=${encodeURIComponent(input.requestedAt!)}`);
      const envelopes = Array.isArray(result.envelopes) ? result.envelopes : [];
      if (envelopes.length > 1) throw new ConflictException('Plusieurs enveloppes correspondent à cette tentative.');
      return envelopes.length ? string(object(envelopes[0]).envelopeId) : '';
    };
    let id = await lookup();
    if (!id) {
      const files = [input.document, ...(input.annexes ?? [])];
      const extensions: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
      const body = {
        transactionId: input.transactionId, emailSubject: input.subject, status: 'sent',
        documents: files.map((file, index) => {
          if (!extensions[file.mimeType]) throw new BadRequestException('Annexe à fournir au format PDF, JPEG ou PNG.');
          return { documentId: String(index + 1), name: file.fileName, fileExtension: extensions[file.mimeType], documentBase64: file.content.toString('base64') };
        }),
        recipients: { signers: input.signers.map(signer => ({
          recipientId: signer.role === 'LANDLORD' ? '1' : '2', routingOrder: '1', roleName: signer.role,
          name: signer.fullName, email: signer.email,
          tabs: { signHereTabs: [{ documentId: '1', pageNumber: String(input.document.signaturePage), xPosition: signer.role === 'LANDLORD' ? '70' : '330', yPosition: '165' }] },
        })) },
        notification: { useAccountDefaults: 'false', expirations: { expireEnabled: 'true', expireAfter: String(input.expiresInDays), expireWarn: '1' } },
        customFields: { textCustomFields: [{ name: 'whomaRequestId', value: input.transactionId, show: 'false' }, { name: 'whomaChecksum', value: input.checksum, show: 'false' }] },
      };
      const response = await this.request('/envelopes', 'POST', body);
      if (response.ok) id = string(object(await response.json()).envelopeId);
      else {
        // Une demande concurrente ou une réponse perdue ne crée jamais une nouvelle clé.
        id = await lookup();
        if (!id) throw new ServiceUnavailableException('Envoi DocuSign non confirmé. Réessayez avec cette même tentative.');
      }
    }
    if (!id) throw new ServiceUnavailableException('Identifiant DocuSign absent.');
    return { id, status: 'sent', signingUrls: {}, expiresAt: new Date(requested + input.expiresInDays * 86400_000) };
  }

  parseEvent(payload: Buffer, signature: string | undefined): SignatureEvent {
    const expected = createHmac('sha256', this.hmac).update(payload).digest();
    const actual = Buffer.from(signature ?? '', 'base64');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new BadRequestException('Signature DocuSign invalide.');
    let body: Json;
    try { body = object(JSON.parse(payload.toString('utf8'))); } catch { throw new BadRequestException('Notification DocuSign illisible.'); }
    const data = object(body.data);
    if (data.accountId !== this.account) throw new BadRequestException('Compte DocuSign incorrect.');
    const eventName = string(body.event);
    const mapping: Record<string, SignatureEvent['type']> = { 'envelope-sent': 'sent', 'envelope-delivered': 'delivered', 'envelope-completed': 'completed', 'envelope-declined': 'declined', 'envelope-voided': 'voided', 'recipient-completed': 'signed' };
    if (!mapping[eventName]) throw new BadRequestException('Type Connect non configuré.');
    const event: SignatureEvent = { id: createHash('sha256').update(payload).digest('hex'), envelopeId: string(data.envelopeId),
      type: mapping[eventName], signerId: eventName === 'recipient-completed' ? data.recipientId === '1' || data.recipientId === 1 ? 'LANDLORD' : data.recipientId === '2' || data.recipientId === 2 ? 'TENANT' : null : null,
      occurredAt: new Date(string(body.generatedDateTime)), reason: null,
    };
    validateSignatureEvent(event); return event;
  }

  async readEvents(id: string, expected: SignatureSigner[]): Promise<SignatureEvent[]> {
    const envelope = await this.json(`/envelopes/${encodeURIComponent(id)}`);
    const recipients = await this.json(`/envelopes/${encodeURIComponent(id)}/recipients`);
    const signers = Array.isArray(recipients.signers) ? recipients.signers.map(object) : [];
    if (signers.length !== 2 || expected.length !== 2) throw new BadRequestException('Signataires DocuSign incohérents.');
    const events: SignatureEvent[] = [];
    for (const signer of expected) {
      const remote = signers.find(r => r.recipientId === (signer.role === 'LANDLORD' ? '1' : '2'));
      if (!remote || string(remote.email).toLowerCase() !== signer.email.toLowerCase() || remote.name !== signer.fullName) throw new BadRequestException('Destinataire DocuSign modifié : contrôle humain nécessaire.');
      if (remote.status === 'completed') events.push({ id: `${id}:${signer.role}:signed`, envelopeId: id, type: 'signed', signerId: signer.role, occurredAt: new Date(string(remote.signedDateTime)), reason: null });
    }
    const status = string(envelope.status);
    if (['completed', 'declined', 'voided'].includes(status)) events.push({ id: `${id}:${status}`, envelopeId: id, type: status as SignatureEvent['type'], signerId: null,
      occurredAt: new Date(string(envelope[`${status}DateTime`]) || string(envelope.statusChangedDateTime)), reason: status === 'voided' ? string(envelope.voidedReason).slice(0, 1000) || null : null,
    });
    events.forEach(validateSignatureEvent); return events;
  }

  async voidEnvelope(id: string, reason: string): Promise<void> {
    await this.json(`/envelopes/${encodeURIComponent(id)}`, 'PUT', { status: 'voided', voidedReason: reason });
  }

  async requestIdFor(id: string): Promise<string | null> {
    const data = await this.json(`/envelopes/${encodeURIComponent(id)}/custom_fields`);
    const fields = Array.isArray(data.textCustomFields) ? data.textCustomFields.map(object) : [];
    return string(fields.find(field => field.name === 'whomaRequestId')?.value) || null;
  }

  async downloadSigned(id: string): Promise<{ content: Buffer; mimeType: string }> {
    const state = await this.json(`/envelopes/${encodeURIComponent(id)}`);
    if (state.status !== 'completed') throw new ConflictException('Le document signé n’est pas encore finalisé par DocuSign.');
    const response = await this.request(`/envelopes/${encodeURIComponent(id)}/documents/combined?certificate=true`);
    if (!response.ok || !response.body) throw new ServiceUnavailableException('Document signé indisponible chez DocuSign.');
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 20 * 1024 * 1024) throw new BadRequestException('Document signé trop volumineux.'); chunks.push(chunk); }
    const content = Buffer.concat(chunks);
    if (content.subarray(0, 5).toString() !== '%PDF-') throw new BadRequestException('Document signé invalide.');
    return { content, mimeType: 'application/pdf' };
  }
}
