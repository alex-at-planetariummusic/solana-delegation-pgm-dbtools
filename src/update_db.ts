import {getEpochData, loadRepo} from "./utils/git";
import {Cluster, TABLES} from "./utils/db_utils";
import client from "./utils/client";
// import bs58 from 'bs58';
const bs58 = require("bs58");
import {QueryResult} from "pg";
import {
  CLUSTERS,
  DELEGATION_PROGRAM_KEY,
  VALIDATOR_PARTICIPANT_STATE_ID_TO_KEY,
  VALIDATOR_PARTICIPANT_STATES
} from "./utils/constants";
import {clusterApiUrl, Connection, PublicKey} from "@solana/web3.js";


(async () => {
  await loadRepo();
  await client.connect();
  try {
    await client.query('BEGIN');

    console.log('in it')
    // const mostRecentMainnetEpoch = getMostRecentEpochInDBForCluster(Cluster.MainnetBeta, )
    // await insertEpochStats(Cluster.Testnet, 220);

    const delegationProgramAccounts = await getDelegationProgramAccounts();

    // console.log('delegation accounts', delegationProgramAccounts);


    // update ValidatorKeyPair table
    for (let i = 0; i < delegationProgramAccounts.length; i++) {
      const account = delegationProgramAccounts[i].account;

      const owner: PublicKey = account.owner;

      console.log(account);
      // console.log(owner.toBase58());


      // Rust struct defined in git@github.com:solana-labs/stake-o-matic.git program/src/state.rs
      // pub struct Participant {
      //     pub testnet_identity: Pubkey, // offset 0 bytes
      //     pub mainnet_identity: Pubkey, // offset 32 bytes
      //     pub state: ParticipantState, // byte index 64
      // }
      const testnet_key = bs58.encode(account.data.slice(0, 32));
      const mainnet_key = bs58.encode(account.data.slice(32, 64));
      const state = VALIDATOR_PARTICIPANT_STATE_ID_TO_KEY[account.data[64]];
      console.log(`TN: ${testnet_key}`);
      console.log(`MN: ${mainnet_key}`);
      console.log(`STATE: ${state}`);

      // find the row
      // await client.query

    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Failed: ", e);
    process.exit(1);
    return;
  }

  console.log('Done');
  process.exit(0);
})();


async function insertEpochStats(cluster: Cluster, epoch: number) {
  const epochData = await getEpochData(cluster, epoch);

  // console.log(Object.keys(epochData));

  // YAML:
  // config:
  //   require_classification: false
  //   quality_block_producer_percentage: 35
  //   max_poor_block_producer_percentage: 90
  //   max_commission: 100
  //   min_release_version: 1.7.9
  //   max_old_release_version_percentage: 10
  //   max_poor_voter_percentage: 90
  //   max_infrastructure_concentration: ~
  //   infrastructure_concentration_affects: WarnAll
  //   bad_cluster_average_skip_rate: 50
  //   min_epoch_credit_percentage_of_average: 5
  //   min_self_stake_lamports: 0
  //   max_active_stake_lamports: 3500000000000000
  //   enforce_min_self_stake: false
  //   enforce_testnet_participation: false
  //   min_testnet_participation: ~
  //   baseline_stake_amount_lamports: ~
  // stats:
  //   bonus_stake_amount: 12345
  //   min_epoch_credits: 197262
  //   avg_epoch_credits: 207645
  //   max_skip_rate: 60
  //   cluster_average_skip_rate: 25
  //   total_active_stake: 82042880903156899
  if (!epochData.V1) {
    throw new Error("Unknown EpochClassification version");
  }

  const stats = epochData.V1.stats;
  const config = epochData.V1.config;

  console.log(config);

  const statsDbData = {
    active_stake: stats.total_active_stake,
    avg_skip_rate: stats.cluster_average_skip_rate,
    max_skip_rate: stats.max_skip_rate,
    max_commission: config.max_commission,
    max_self_stake: config.max_active_stake_lamports,
    min_self_stake: config.min_self_stake_lamports,
    skip_rate_grace: config.min_epoch_credit_percentage_of_average,
    stake_pool_size: 'todo',
    avg_vote_credits: stats.avg_epoch_credits,
    min_vote_credits: stats.min_epoch_credits,
    bonus_stake_amount: stats.bonus_stake_amount,
    min_solana_version: config.min_solana_version,
    baseline_stake_amount: stats.baseline_stake_amount,
    // num_no_stake_validators: 17,
    // num_validators_processed: 550,
    // num_bonus_stake_validators: 477,
    // vote_credits_grace_percent: 35,
    // num_baseline_stake_validators: 56,
    max_infrastructure_concentration: config.max_infrastructure_concentration,
    min_testnet_participation_numerator: config.min_testnet_participation_numerator?.[0],
    min_testnet_participation_denominator: config.min_testnet_participation_numerator?.[1],
    // stake_pool_available_for_delegation: 'todo',
  };

  console.log(statsDbData);

  try {
    console.log('doing query?????????????');

    const res: QueryResult = await client.query(`INSERT INTO ${TABLES.EpochStats} (
      cluster,
      epoch,
      stats
    ) VALUES (
      $1, $2, $3
    )`, [
      cluster,
      epoch,
      statsDbData
    ]);
    console.log('done?', res);

  } catch (e) {
    console.error(':(');
    console.error(e);
  }
}

async function importValidatorEpochStats(cluster: Cluster, epoch: number) {
  `UPDATE "ValidatorEpochStats"
  SET epoch=$1,
    cluster=$2,
    stats=$3
  WHERE id=$4`





}


async function updateKeypairTable(mainnet_beta_key: string, testnet_key: string, state: VALIDATOR_PARTICIPANT_STATES): Promise<any> {

  const matchingKeyPair = await client.query(`SELECT id, state 
    FROM ${TABLES.ValidatorKeyPair}
    WHERE mainnet_beta_pk=$1 AND
        testnet_pk=$2`,
  [
    mainnet_beta_key,
    testnet_key,
]);

  if (matchingKeyPair.rows.length > 1) {
    throw new Error(`> 1 rows for mn ${mainnet_beta_key}, tn ${testnet_key}`)
  } else if (matchingKeyPair.rows.length === 1) {


  } else {
    await client.query(`INSERT INTO ${TABLES.ValidatorKeyPair} (
          mainnet_beta_pk,
          testnet_pk
          state
        ) VALUES (
          $1,
          $2,
          $3
        )`, [
          mainnet_beta_key,
          testnet_key,
          state
    ])
  }

}


async function getDelegationProgramAccounts(): Promise<Record<string, any>> {
  const connection = await new Connection(clusterApiUrl(CLUSTERS.MAINNET_BETA))
  return await connection.getParsedProgramAccounts(
    DELEGATION_PROGRAM_KEY,
  );
}


