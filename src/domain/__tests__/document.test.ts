import { describe, expect, it } from 'vitest';
import { checkDocumentCoverage, getDocumentHistory, registerDocument, reviseDocument } from '../document';
import type { DesignDocument, EngineeringChange, PlmItem } from '../types';

describe('document domain', () => {
  // UC-DOC-1
  it('links a registered drawing to the item.drawingRef', () => {
    const items: PlmItem[] = [{ itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産' }];
    const documents: DesignDocument[] = [];
    registerDocument(documents, items, { docId: 'DOC-FG100', relatedItemId: 'FG-100', docType: '図面' });
    expect(items[0].drawingRef).toBe('DOC-FG100');
  });

  // UC-DOC-2
  it('bumps the version on revision while keeping the old version accessible', () => {
    const items: PlmItem[] = [{ itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産' }];
    const documents: DesignDocument[] = [];
    registerDocument(documents, items, { docId: 'DOC-FG100', relatedItemId: 'FG-100', docType: '図面' });
    reviseDocument(documents, 'DOC-FG100');

    const history = getDocumentHistory(documents, 'DOC-FG100');
    expect(history.map((d) => d.version)).toEqual([1, 2]);
  });

  // UC-DOC-3
  it('warns when an ECO targets an item that has no drawing registered', () => {
    const items: PlmItem[] = [{ itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産' }];
    const change: EngineeringChange = {
      changeId: 'ECR-1',
      type: 'ECR',
      status: '起票',
      reason: 'コスト削減',
      changeLevel: '軽微',
      impactedItemIds: ['FG-100'],
      impactedBomLineIds: [],
      approvals: [],
    };
    expect(checkDocumentCoverage(change, items)).toHaveLength(1);
  });
});
