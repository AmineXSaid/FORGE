import * as vscode from 'vscode';
import { chatLocationFrom, DEFAULT_CHAT_LOCATION, type ChatLocation } from '../shared/chatLocation';

/** `forge.preferredLocation`, read the one way every caller should read it. */
export function readChatLocation(): ChatLocation {
    return chatLocationFrom(
        vscode.workspace.getConfiguration('forge').get<string>('preferredLocation', DEFAULT_CHAT_LOCATION),
    );
}
