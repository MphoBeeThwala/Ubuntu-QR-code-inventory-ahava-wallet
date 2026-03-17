// Minimal MLRO notifier stub. In production, this would send an email/Slack/alert
// to the MLRO team and/or create a ticket in the case management system.

import { AmlFlag } from '@prisma/client';

export class MlroNotifier {
  async notifyFlag(flag: AmlFlag): Promise<void> {
    // TODO: integrate with real MLRO notification channel (email/SMS/Slack)
    console.warn('MLRO notification stub called for flag', flag.id);
  }
}
