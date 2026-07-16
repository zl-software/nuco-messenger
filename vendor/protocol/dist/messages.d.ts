import type { ProtocolVersion } from './version.js';
import type { ErrorCodeValue } from './errors.js';
export type PushKind = 'apns' | 'unifiedpush' | 'none';
export interface PushRegistration {
    readonly kind: PushKind;
    readonly token?: string;
    readonly endpoint?: string;
    readonly apnsTopic?: string;
    readonly voipToken?: string;
}
export type WakeHint = 'alert' | 'voip' | 'none';
export type CipherMessageType = 'prekey' | 'whisper';
export interface MessageEnvelope {
    readonly id: string;
    readonly ciphertext: string;
    readonly messageType: CipherMessageType;
    readonly sentAt: number;
}
export interface ConnectMsg {
    readonly type: 'connect';
    readonly protocolVersion: ProtocolVersion;
    readonly handle: string;
}
export interface AuthenticateMsg {
    readonly type: 'authenticate';
    readonly signature: string;
}
export interface RegisterAttestation {
    readonly kind: string;
    readonly keyId: string;
    readonly data: string;
}
export interface RegisterMsg {
    readonly type: 'register';
    readonly rid: string;
    readonly authKey: string;
    readonly deviceId: number;
    readonly push: PushRegistration;
    readonly attestation?: RegisterAttestation;
}
export interface SendMsg {
    readonly type: 'send';
    readonly rid: string;
    readonly to: string;
    readonly envelope: MessageEnvelope;
    readonly wake?: WakeHint;
}
export interface AckMsg {
    readonly type: 'ack';
    readonly id: string;
}
export interface PingMsg {
    readonly type: 'ping';
    readonly ts: number;
}
export interface DeregisterMsg {
    readonly type: 'deregister';
    readonly rid: string;
}
export interface TurnCredentialsMsg {
    readonly type: 'turnCredentials';
    readonly rid: string;
}
export type ReportCategory = 'spam' | 'harassment' | 'illegal' | 'other';
export type ReportContext = 'contact' | 'message';
export interface ReportMsg {
    readonly type: 'report';
    readonly rid: string;
    readonly handle: string;
    readonly category: ReportCategory;
    readonly comment?: string;
    readonly context?: ReportContext;
}
export type ClientMessage = ConnectMsg | AuthenticateMsg | RegisterMsg | SendMsg | AckMsg | PingMsg | DeregisterMsg | TurnCredentialsMsg | ReportMsg;
export type ClientMessageType = ClientMessage['type'];
export interface ConnectedMsg {
    readonly type: 'connected';
    readonly protocolVersion: ProtocolVersion;
    readonly challenge: string;
}
export interface AuthenticatedMsg {
    readonly type: 'authenticated';
}
export interface OkMsg {
    readonly type: 'ok';
    readonly rid: string;
    readonly data?: Record<string, unknown>;
}
export interface TurnCredentialsResultMsg {
    readonly type: 'turnCredentialsResult';
    readonly rid: string;
    readonly urls: readonly string[];
    readonly username: string;
    readonly credential: string;
    readonly expiresAt: number;
}
export interface DeliverMsg {
    readonly type: 'deliver';
    readonly from: string;
    readonly envelope: MessageEnvelope;
    readonly seq: number;
}
export interface ErrorMsg {
    readonly type: 'error';
    readonly code: ErrorCodeValue;
    readonly rid?: string;
}
export interface PongMsg {
    readonly type: 'pong';
    readonly ts: number;
}
export type ServerMessage = ConnectedMsg | AuthenticatedMsg | OkMsg | TurnCredentialsResultMsg | DeliverMsg | ErrorMsg | PongMsg;
export type ServerMessageType = ServerMessage['type'];
export declare const CLIENT_MESSAGE_TYPES: ClientMessageType[];
export declare const SERVER_MESSAGE_TYPES: ServerMessageType[];
//# sourceMappingURL=messages.d.ts.map