import { z } from 'zod';
import { CONSENT_KINDS } from '../../domain/vocabulary.ts';
import type { ConsentDocumentState, ConsentState, ConsentStatus } from '../../services/consents.ts';
import { IsoDateTime, isoOrNull } from './common.ts';

const ConsentKindSchema = z
  .enum(CONSENT_KINDS)
  .describe('personal_data - обработка персональных данных, personalized_offers - персональные предложения');

export const ConsentKindParams = z.object({ kind: ConsentKindSchema });

export const GrantConsentBody = z.object({
  version: z
    .string()
    .min(1)
    .max(32)
    .describe('Версия текста, который увидел пользователь, из GET /api/v1/consents'),
});

export const ConsentStateSchema = z
  .object({
    granted: z.boolean().describe('true, только если действует согласие на актуальную версию текста'),
    version: z
      .string()
      .nullable()
      .describe(
        'Версия действующего согласия, null если согласия нет. Устаревшая версия означает, что согласие нужно дать заново',
      ),
    grantedAt: IsoDateTime.nullable().describe('Когда дано действующее согласие'),
  })
  .meta({ id: 'ConsentState', description: 'Состояние согласия пользователя' });

export const ConsentStatusSchema = z
  .object({
    personalData: ConsentStateSchema,
    personalizedOffers: ConsentStateSchema,
  })
  .meta({ id: 'ConsentStatus', description: 'Состояние обоих согласий пользователя' });

export const ConsentDocumentSchema = z
  .object({
    kind: ConsentKindSchema,
    version: z.string().describe('Актуальная версия текста, её передают в PUT /api/v1/consents/{kind}'),
    title: z.string(),
    text: z.string().describe('Полный текст согласия, абзацы разделены пустой строкой'),
    required: z.boolean().describe('Без обязательного согласия дневник и профиль не сохраняются'),
    granted: z.boolean().describe('Действует ли согласие пользователя на актуальную версию'),
    grantedAt: IsoDateTime.nullable().describe('Когда дано действующее согласие'),
  })
  .meta({ id: 'ConsentDocument', description: 'Текст согласия и его состояние у пользователя' });

export const ConsentDocumentListSchema = z.object({ items: z.array(ConsentDocumentSchema) });

export function toConsentState(state: ConsentState): z.infer<typeof ConsentStateSchema> {
  return { granted: state.granted, version: state.version, grantedAt: isoOrNull(state.grantedAt) };
}

export function toConsentStatus(status: ConsentStatus): z.infer<typeof ConsentStatusSchema> {
  return {
    personalData: toConsentState(status.personalData),
    personalizedOffers: toConsentState(status.personalizedOffers),
  };
}

export function toConsentDocument(document: ConsentDocumentState): z.infer<typeof ConsentDocumentSchema> {
  return { ...document, grantedAt: isoOrNull(document.grantedAt) };
}
