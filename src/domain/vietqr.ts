export function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(s)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id: string, value: string): string {
  if (value.length > 99) throw new RangeError(`VietQR field ${id} too long`);
  return id + String(value.length).padStart(2, '0') + value;
}

export function paymentReference(billNumber: string): string {
  return billNumber.replace(/-/g, '');
}

export interface VietQrInput {
  bankBin: string;
  accountNumber: string;
  amount: number;
  reference: string;
}

export function buildVietQrPayload({ bankBin, accountNumber, amount, reference }: VietQrInput): string {
  const account = accountNumber.replace(/[\s.]/g, '');
  if (!/^\d{6}$/.test(bankBin)) throw new Error('Bank BIN must be 6 digits');
  if (!/^\d{1,19}$/.test(account)) throw new Error('Invalid account number');
  if (!Number.isInteger(amount) || amount < 0) throw new Error('Invalid amount');

  const merchantAccount =
    tlv('00', 'A000000727') + tlv('01', tlv('00', bankBin) + tlv('01', account)) + tlv('02', 'QRIBFTTA');

  const payload =
    tlv('00', '01') +
    tlv('01', amount > 0 ? '12' : '11') +
    tlv('38', merchantAccount) +
    tlv('53', '704') +
    (amount > 0 ? tlv('54', String(amount)) : '') +
    tlv('58', 'VN') +
    tlv('62', tlv('08', reference)) +
    '6304';
  return payload + crc16(payload);
}
