import { AdReferral } from "./webhook-store";

export interface AdLead {
  senderId: string;
  pageId: string;
  referral: AdReferral;
  firstMessageText: string;
  timestamp: number;
}

const MAX = 500;

const proc = process as NodeJS.Process & {
  _adLeads?: AdLead[];
  _adSenderMap?: Map<string, AdLead>;
};
if (!proc._adLeads) proc._adLeads = [];
if (!proc._adSenderMap) proc._adSenderMap = new Map();

const leads = proc._adLeads;
const senderMap = proc._adSenderMap;

export function recordAdLead(lead: AdLead) {
  senderMap.set(lead.senderId, lead);
  const idx = leads.findIndex((l) => l.senderId === lead.senderId);
  if (idx >= 0) leads.splice(idx, 1);
  leads.unshift(lead);
  if (leads.length > MAX) leads.pop();
}

export function getAdLeads(pageId?: string): AdLead[] {
  if (pageId) return leads.filter((l) => l.pageId === pageId);
  return leads;
}

export function getAdLeadBySender(senderId: string): AdLead | undefined {
  return senderMap.get(senderId);
}
