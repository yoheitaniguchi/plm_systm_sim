// 文書・版数ドメイン：図面・仕様書（3章#5、1.3、2.4節）。
import type { DesignDocument, EngineeringChange, PlmItem } from './types';

export interface NewDocumentInput {
  docId: string;
  relatedItemId: string;
  docType: '図面' | '仕様書';
}

// UC-DOC-1: 図面を登録すると、品目のdrawingRefに紐づく。
export function registerDocument(
  documents: DesignDocument[],
  items: PlmItem[],
  input: NewDocumentInput,
): DesignDocument {
  const item = items.find((i) => i.itemId === input.relatedItemId);
  if (!item) throw new Error(`品目 ${input.relatedItemId} が見つかりません`);
  if (documents.some((d) => d.docId === input.docId)) {
    throw new Error(`文書コード ${input.docId} は既に登録されています`);
  }
  const doc: DesignDocument = { ...input, version: 1 };
  documents.push(doc);
  item.drawingRef = doc.docId;
  return doc;
}

// UC-DOC-2: ECOにより改訂すると版数が上がり、旧版は削除せず参照可能なまま保持される
// （履歴を消さないという原則を文書ドメインにも適用）。
export function reviseDocument(documents: DesignDocument[], docId: string): DesignDocument {
  const latest = getLatestDocumentVersion(documents, docId);
  if (!latest) throw new Error(`文書 ${docId} が見つかりません`);
  const revised: DesignDocument = { ...latest, version: latest.version + 1 };
  documents.push(revised);
  return revised;
}

export function getDocumentHistory(documents: DesignDocument[], docId: string): DesignDocument[] {
  return documents.filter((d) => d.docId === docId).sort((a, b) => a.version - b.version);
}

export function getLatestDocumentVersion(
  documents: DesignDocument[],
  docId: string,
): DesignDocument | undefined {
  const history = getDocumentHistory(documents, docId);
  return history.at(-1);
}

// UC-DOC-3: 図面未登録の品目をECOで変更対象にすると警告が表示される（2.4節）。
export function checkDocumentCoverage(change: EngineeringChange, items: PlmItem[]): string[] {
  const warnings: string[] = [];
  for (const itemId of change.impactedItemIds) {
    const item = items.find((i) => i.itemId === itemId);
    if (item && !item.drawingRef) {
      warnings.push(`品目 ${itemId} には図面が登録されていません`);
    }
  }
  return warnings;
}
