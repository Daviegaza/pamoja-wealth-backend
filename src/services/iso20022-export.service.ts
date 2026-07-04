/**
 * ISO 20022 pain.001 export.
 *
 * Generates a Customer Credit Transfer Initiation XML for chama batch
 * payouts (dividends, member withdrawals). Compatible with every ISO
 * 20022 bank rail: Pesalink, RTGS, SEPA, SWIFT gpi.
 *
 * https://www.iso20022.org/iso-20022-message-definitions
 *
 * Envelope structure:
 *   Document > CstmrCdtTrfInitn > GrpHdr + PmtInf[+CdtTrfTxInf*]
 *
 * Only the fields Kenyan RTGS + Pesalink actually validate on. Extend
 * for cross-border SWIFT gpi as needed.
 */

export interface CreditTransfer {
  endToEndId: string;
  amountKes: number;
  debtorName: string;
  debtorAccount: string;
  creditorName: string;
  creditorAccount: string;
  creditorBankBic?: string;
  remittanceInfo: string;
}

export interface BatchInput {
  messageId: string;
  initiatingParty: string;
  debtorName: string;
  debtorIban: string;
  transfers: CreditTransfer[];
}

function esc(s: string): string {
  return s.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

function money(n: number): string {
  return n.toFixed(2);
}

export function buildIso20022Pain001(input: BatchInput): { xml: string; filename: string } {
  const now = new Date().toISOString();
  const total = input.transfers.reduce((s, t) => s + t.amountKes, 0);
  const txCount = input.transfers.length;

  const txs = input.transfers.map((t, i) => `
      <CdtTrfTxInf>
        <PmtId>
          <InstrId>${esc(t.endToEndId)}-${i + 1}</InstrId>
          <EndToEndId>${esc(t.endToEndId)}</EndToEndId>
        </PmtId>
        <Amt><InstdAmt Ccy="KES">${money(t.amountKes)}</InstdAmt></Amt>
        <CdtrAgt><FinInstnId>${t.creditorBankBic ? `<BIC>${esc(t.creditorBankBic)}</BIC>` : "<Nm>Local</Nm>"}</FinInstnId></CdtrAgt>
        <Cdtr><Nm>${esc(t.creditorName)}</Nm></Cdtr>
        <CdtrAcct><Id><Othr><Id>${esc(t.creditorAccount)}</Id></Othr></Id></CdtrAcct>
        <RmtInf><Ustrd>${esc(t.remittanceInfo)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(input.messageId)}</MsgId>
      <CreDtTm>${now}</CreDtTm>
      <NbOfTxs>${txCount}</NbOfTxs>
      <CtrlSum>${money(total)}</CtrlSum>
      <InitgPty><Nm>${esc(input.initiatingParty)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(input.messageId)}-B1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${txCount}</NbOfTxs>
      <CtrlSum>${money(total)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${now.slice(0, 10)}</ReqdExctnDt>
      <Dbtr><Nm>${esc(input.debtorName)}</Nm></Dbtr>
      <DbtrAcct><Id><Othr><Id>${esc(input.debtorIban)}</Id></Othr></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><Nm>Debtor Bank</Nm></FinInstnId></DbtrAgt>${txs}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;

  return {
    xml,
    filename: `pain001_${input.messageId}_${now.slice(0, 10)}.xml`,
  };
}
