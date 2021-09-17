import {Cluster, PublicKey} from "@solana/web3.js";

export const DELEGATION_PROGRAM_KEY_STRING = 'reg8X1V65CSdmrtEjMgnXZk96b9SUSQrJ8n1rP1ZMg7';
export const DELEGATION_PROGRAM_KEY = new PublicKey(DELEGATION_PROGRAM_KEY_STRING);

export enum VALIDATOR_PARTICIPANT_STATES {
  UNINITIALIZED = "Uninitialized",
  APPROVED = "Approved",
  PENDING = "Pending",
  REJECTED = "Rejected",
}

export enum CLUSTERS {
  MAINNET_BETA = 'mainnet-beta',
  TESTNET = 'testnet'
}

// Rust struct defined in git@github.com:solana-labs/stake-o-matic.git program/src/state.rs
export const VALIDATOR_PARTICIPANT_STATE_IDS: Record<VALIDATOR_PARTICIPANT_STATES, number> = {
  [VALIDATOR_PARTICIPANT_STATES.UNINITIALIZED]: 0,
  [VALIDATOR_PARTICIPANT_STATES.PENDING]: 1,
  [VALIDATOR_PARTICIPANT_STATES.REJECTED]: 2,
  [VALIDATOR_PARTICIPANT_STATES.APPROVED]: 3,
};

/**
 * Map of IDs to VALIDATOR_PARTICIPANT_STATES
 */
export const VALIDATOR_PARTICIPANT_STATE_ID_TO_KEY = Object.entries(
  VALIDATOR_PARTICIPANT_STATE_IDS
).reduce((acc, entry) => {
  acc[entry[1]] = entry[0];
  return acc;
}, {});

export type Participant = {
  mainnet_identity: PublicKey;
  testnet_identity: PublicKey;
  pubkey: PublicKey,
  state: VALIDATOR_PARTICIPANT_STATES
};

export type DataCenter = {
  location: string,
  asn: number
}
