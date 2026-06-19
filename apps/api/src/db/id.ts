import { uuidv7 } from 'uuidv7';

/**
 * App-side UUID v7 primary key generator (contract section 0). Time-ordered so
 * inserts stay roughly sequential on the PK index while remaining URL/GCS-path
 * safe and non-guessable across tenants.
 */
export function newId(): string {
  return uuidv7();
}
