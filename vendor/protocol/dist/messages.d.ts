import type { ProtocolVersion } from './version.js';
import type { PreKeyUpload, PreKeyBundle } from './prekeys.js';
import type { ErrorCodeValue } from './errors.js';
export type PushKind = 'apns' | 'unifiedpush' | 'none';
export interface PushRegistration {
    readonly kind: PushKind;
    readonly token?: string;
    readonly endpoint?: string;
    readonly apnsTopic?: string;
}
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
export interface RegisterMsg {
    readonly type: 'register';
    readonly rid: string;
    readonly identityKey: string;
    readonly authKey: string;
    readonly registrationId: number;
    readonly deviceId: number;
    readonly push: PushRegistration;
}
export interface PublishPreKeysMsg {
    readonly type: 'publishPreKeys';
    readonly rid: string;
    readonly preKeys: PreKeyUpload;
}
export interface FetchPreKeyBundleMsg {
    readonly type: 'fetchPreKeyBundle';
    readonly rid: string;
    readonly handle: string;
}
export interface PreKeyCountMsg {
    readonly type: 'preKeyCount';
    readonly rid: string;
}
export interface SendMsg {
    readonly type: 'send';
    readonly rid: string;
    readonly to: string;
    readonly envelope: MessageEnvelope;
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
export type ClientMessage = ConnectMsg | AuthenticateMsg | RegisterMsg | PublishPreKeysMsg | FetchPreKeyBundleMsg | PreKeyCountMsg | SendMsg | AckMsg | PingMsg | DeregisterMsg | TurnCredentialsMsg;
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
export interface PreKeyBundleMsg {
    readonly type: 'preKeyBundle';
    readonly rid: string;
    readonly bundle: PreKeyBundle;
}
export interface PreKeyCountResultMsg {
    readonly type: 'preKeyCountResult';
    readonly rid: string;
    readonly hasSignedPreKey: boolean;
    readonly oneTimeCount: number;
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
export type ServerMessage = ConnectedMsg | AuthenticatedMsg | OkMsg | PreKeyBundleMsg | PreKeyCountResultMsg | TurnCredentialsResultMsg | DeliverMsg | ErrorMsg | PongMsg;
export type ServerMessageType = ServerMessage['type'];
export declare const CLIENT_MESSAGE_TYPES: ClientMessageType[];
export declare const SERVER_MESSAGE_TYPES: ServerMessageType[];
//# sourceMappingURL=messages.d.ts.map