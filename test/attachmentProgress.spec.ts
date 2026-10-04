/**
 * Loading chips for attachments (reported 2026-10-04): a large file used to
 * appear in the composer only once fully read. Now it shows at once with its
 * progress, and a message cannot go out while one is still loading.
 */
import { describe, expect, it } from 'vitest';
import {
    attachmentPercent,
    hasPendingAttachments,
    type AttachmentItem,
} from '../src/webview/src/types/attachment';

const item = (over: Partial<AttachmentItem> = {}): AttachmentItem => ({
    id: 'a',
    fileName: 'big.zip',
    mediaType: 'application/zip',
    data: '',
    fileSize: 1000,
    ...over,
});

describe('attachment loading state', () => {
    it('reports the read percentage, clamped and rounded', () => {
        expect(attachmentPercent({ phase: 'reading', loaded: 0, total: 1000 })).toBe(0);
        expect(attachmentPercent({ phase: 'reading', loaded: 333, total: 1000 })).toBe(33);
        expect(attachmentPercent({ phase: 'reading', loaded: 1200, total: 1000 })).toBe(100);
    });

    it('has no percentage once processing, or with no size to measure against', () => {
        expect(attachmentPercent({ phase: 'processing', loaded: 1000, total: 1000 })).toBeUndefined();
        expect(attachmentPercent({ phase: 'reading', loaded: 10, total: 0 })).toBeUndefined();
        expect(attachmentPercent(undefined)).toBeUndefined();
    });

    it('blocks sending only while some chip is still loading', () => {
        expect(hasPendingAttachments([])).toBe(false);
        expect(hasPendingAttachments([item()])).toBe(false);
        expect(hasPendingAttachments([item(), item({ id: 'b', pending: { phase: 'processing', loaded: 1, total: 1 } })])).toBe(true);
    });
});
