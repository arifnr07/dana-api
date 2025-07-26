import * as crypto from 'crypto';

export class DanaSignatureService {
  private hash(string: string): string {
    return crypto.createHash('sha256').update(string).digest('hex');
  }

  signContent(
    content: string,
    privateKey: string,
    encoding: BufferEncoding = 'utf8',
  ): string {
    const sign = crypto.createSign('RSA-SHA256');
    sign.write(content, encoding);
    sign.end();
    return sign.sign(privateKey, 'base64');
  }

  private base64KeyToPEM(
    base64Key: string,
    keyType: 'PRIVATE' | 'PUBLIC',
  ): string {
    return [
      `-----BEGIN ${keyType} KEY-----`,
      ...this.splitStringIntoChunks(base64Key, 64),
      `-----END ${keyType} KEY-----`,
    ].join('\n');
  }

  private splitStringIntoChunks(input: string, chunkSize: number): string[] {
    const chunkCount = Math.ceil(input.length / chunkSize);
    return Array.from({ length: chunkCount }).map((v, chunkIndex) =>
      input.substr(chunkIndex * chunkSize, chunkSize),
    );
  }

  private minifyJSON(jsonString: string): string {
    try {
      // Parse and stringify to remove whitespace
      return JSON.stringify(JSON.parse(jsonString));
    } catch (error) {
      // If not valid JSON, return as is
      return jsonString;
    }
  }
  prepareSignatureData(
    httpMethod: string,
    relativePath: string,
    httpBody: string,
  ): string {
    try {
      const minifiedBody = this.minifyJSON(httpBody);

      // Step 2: Hash the minified body
      const bodyHash = this.hash(minifiedBody);
      const timestamp = this.getTimestamp();
      const stringToSign = `${httpMethod}:${relativePath}:${bodyHash.toLowerCase()}:${timestamp}`;
      return stringToSign;
    } catch (error) {
      console.error('Error preparing signature:', error);
      throw new Error(`Failed to preparing signature: ${error.message}`);
    }
  }
  // Generate signature for DANA API
  generateSignature(signatureData: string, privateKey: string): string {
    try {
      // Step 1: Minify the HTTP body (remove whitespace from JSON)

      // Step 3: Construct the string to sign
      // Format: <HTTP METHOD>:<RELATIVE PATH>:<LOWERCASE_HEX_SHA256_BODY>:<TIMESTAMP>
      const stringToSign = `${signatureData}`;

      console.log('String to sign:', stringToSign);

      // Step 4: Convert base64 private key to PEM format
      const pemPrivateKey = this.base64KeyToPEM(privateKey, 'PRIVATE');

      // Step 5: Sign the string
      const signature = this.signContent(stringToSign, pemPrivateKey);
      console.log('Signature:', signature);
      return signature;
    } catch (error) {
      console.error('Error generating signature:', error);
      throw new Error(`Failed to generate signature: ${error.message}`);
    }
  }

  // Get current timestamp in ISO format
  getTimestamp(): string {
    const date = new Date();
    const pad = (n) => n.toString().padStart(2, '0');

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    const offset = -date.getTimezoneOffset(); // in minutes
    const sign = offset >= 0 ? '+' : '-';
    const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
    const offsetMinutes = pad(Math.abs(offset) % 60);

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMinutes}`;
  }

  // Verify signature (for testing)
  verifySignature(
    content: string,
    publicKey: string,
    signature: string,
    encoding: BufferEncoding = 'utf8',
  ): boolean {
    try {
      const verify = crypto.createVerify('SHA256');
      verify.write(content, encoding);
      verify.end();
      const pemPublicKey = this.base64KeyToPEM(publicKey, 'PUBLIC');
      return verify.verify(pemPublicKey, Buffer.from(signature, 'base64'));
    } catch (error) {
      console.error('Error verifying signature:', error);
      return false;
    }
  }
}
