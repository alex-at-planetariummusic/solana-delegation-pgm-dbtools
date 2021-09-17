import {clusterApiUrl, Connection, PublicKey} from "@solana/web3.js";
import {CLUSTERS, DELEGATION_PROGRAM_KEY, Participant, VALIDATOR_PARTICIPANT_STATE_ID_TO_KEY} from "./constants";

export async function getDelegationProgramAccounts(): Promise<Record<string, any>> {
  const connection = await new Connection(clusterApiUrl(CLUSTERS.MAINNET_BETA))
  return await connection.getParsedProgramAccounts(
    DELEGATION_PROGRAM_KEY,
  );
}

export async function getParsedDelegationProgramAccounts(): Promise<Participant[]> {
  const delegationProgramAccounts = await getDelegationProgramAccounts()

  const parsedAcounts = [];
  //
  // const mnKeys = [];
  // const tnKeys = [];

  for (let i = 0; i < delegationProgramAccounts.length; i++) {
    const account = delegationProgramAccounts[i].account;
    // console.log(delegationProgramAccounts[i].pubkey.toBase58());

    // Rust struct defined in git@github.com:solana-labs/stake-o-matic.git program/src/state.rs
    // pub struct Participant {
    //     pub testnet_identity: Pubkey, // offset 0 bytes
    //     pub mainnet_identity: Pubkey, // offset 32 bytes
    //     pub state: ParticipantState, // byte index 64
    // }
    const participant: Participant = {
      mainnet_identity: new PublicKey(account.data.slice(32, 64)),
      testnet_identity: new PublicKey(account.data.slice(0, 32)),
      state: VALIDATOR_PARTICIPANT_STATE_ID_TO_KEY[account.data[64]],
      pubkey: delegationProgramAccounts[i].pubkey
    }
    parsedAcounts.push(participant)

    // const mnKey = participant.mainnet_identity.toBase58();
    // const tnKey = participant.testnet_identity.toBase58();
    //
    // if (mnKeys.indexOf(mnKey) !== -1) {
    //   console.warn(`Duplicate MN key ${mnKey} (${participant.state})`);
    // }
    // if (tnKeys.indexOf(tnKey) !== -1) {
    //   console.warn(`Duplicate TN key ${tnKey} (${participant.state})`);
    // }
    //
    // mnKeys.push(mnKey);
    // tnKeys.push(tnKey)

  }
  return parsedAcounts;
}

/**
 * Finds registrations that have the same key as other registrations.
 */
export async function findDuplicateRegistrations() {
  const delegationProgramAccounts = await getParsedDelegationProgramAccounts()

  const duplicates: Record<string, Participant> = {}

  console.log('length:', delegationProgramAccounts.length);

  // I'm a little bit ashamed of this
  delegationProgramAccounts.forEach(participant => {
    const mnKey = participant.mainnet_identity.toBase58();
    const tnKey = participant.testnet_identity.toBase58();
    const pubKey = participant.pubkey.toBase58();

    delegationProgramAccounts.forEach(searchParticipant => {
      if (
        searchParticipant.pubkey.toBase58() !== pubKey &&
        (searchParticipant.testnet_identity.toBase58() === tnKey ||
          searchParticipant.mainnet_identity.toBase58() === mnKey)
      ) {
        duplicates[participant.pubkey.toBase58()] = participant;
      }
    });
  })

  console.log('DUPLICATES:')
  for (const [pubkey, participant] of Object.entries(duplicates)) {
    console.log(`${pubkey}:: TN:${participant.testnet_identity.toBase58()} MN:${participant.mainnet_identity.toBase58()} (${participant.state})`)
  }

}
