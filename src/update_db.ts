import {getEpochData, getEpochsForCluster, loadRepo} from "./utils/git";
import {Cluster, getEpochsInDbForCluster, TABLES} from "./utils/db_utils";
import client from "./utils/client";
import {QueryResult} from "pg";
import {
  CLUSTERS, DataCenter,
  DELEGATION_PROGRAM_KEY, Participant,
  VALIDATOR_PARTICIPANT_STATE_ID_TO_KEY,
  VALIDATOR_PARTICIPANT_STATES
} from "./utils/constants";
import {clusterApiUrl, Connection, LAMPORTS_PER_SOL, PublicKey} from "@solana/web3.js";
import {getDelegationProgramAccounts} from "./utils/rpc_utils";


// TODO: import keybase IDs

// "main"
(async () => {
  await loadRepo();
  await client.connect();
  try {
    await client.query('BEGIN');



    await updateKeypairTable(client)

    // update ValidatorKeyPair table



    // load epoch data for each cluster/epoch
    for (const clusterKey in Cluster) {
      const cluster: Cluster = Cluster[clusterKey as keyof Cluster]

      const epochs = await getEpochsForCluster(cluster);
      const epochsInDb = await getEpochsInDbForCluster(cluster);

      for (let i = 0; i < epochs.length; i++) {
        const epoch = epochs[i];
        const epochData = await getEpochData(cluster, epoch);
        if (epochsInDb.indexOf(epoch) < 0) {
          console.log(`Importing ${cluster}/${epoch}`);
          await importEpochStats(cluster, epoch, epochData);
          await importValidatorEpochStats(cluster, epoch, epochData);
        }
      }
    }

    console.log('COMMITting');
    await client.query('COMMIT');

  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Failed: ", e);
    process.exit(1);
    return;
  } finally {
    await client.end()
  }

  console.log('Done');
  process.exit(0);
})();

export async function updateKeypairTable(client) {
  const delegationProgramAccounts = await getDelegationProgramAccounts();
  const programAccounts: Participant[] = [];
  const mnKeys: string[] = [];

  for (let i = 0; i < delegationProgramAccounts.length; i++) {
    const account = delegationProgramAccounts[i].account;
    console.log(delegationProgramAccounts[i].pubkey.toBase58());

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

    const mnKey = participant.mainnet_identity.toBase58();
    // console.log(participant);
    console.log('mn:', mnKey);

    if (mnKeys.indexOf(mnKey) !== -1) {
      console.log("Duplicate MN key: ", mnKey);
    }

    mnKeys.push(mnKey);

    // console.log('tn:', participant.testnet_identity.toBase58());
    // // console.log(account);
    // console.log('owner:', account.owner.toBase58());
    // console.log('pubkey:', delegationProgramAccounts[i].pubkey.toBase58())
    //
    // console.log('---------------------------------------------')

    programAccounts.push(participant);
    await updateKeypairTableRow(client, participant);
  }

  await pruneValidatorKeyPairTable(client, programAccounts);
}


async function importEpochStats(cluster: Cluster, epoch: number, epochData: Record<string, any>) {

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
  // console.log(config);

  const statsDbData = {
    active_stake: stats.total_active_stake,
    avg_skip_rate: stats.cluster_average_skip_rate,
    max_skip_rate: stats.max_skip_rate,
    max_commission: config.max_commission,
    max_self_stake: config.max_active_stake_lamports / LAMPORTS_PER_SOL,
    min_self_stake: config.min_self_stake_lamports / LAMPORTS_PER_SOL,
    skip_rate_grace: config.min_epoch_credit_percentage_of_average,
    // stake_pool_size: 'todo',
    avg_vote_credits: stats.avg_epoch_credits,
    min_vote_credits: stats.min_epoch_credits,
    bonus_stake_amount: stats.bonus_stake_amount/ LAMPORTS_PER_SOL,
    min_solana_version: config.min_solana_version,
    baseline_stake_amount: config.baseline_stake_amount_lamports / LAMPORTS_PER_SOL,
    // num_no_stake_validators: 17,
    // num_validators_processed: 550,
    // num_bonus_stake_validators: 477,
    // vote_credits_grace_percent: 35,
    // num_baseline_stake_validators: 56,
    max_infrastructure_concentration: config.max_infrastructure_concentration,
    min_testnet_participation_numerator: config.min_testnet_participation_numerator?.[0],
    min_testnet_participation_denominator: config.min_testnet_participation_numerator?.[1],
  };

  await client.query(`INSERT INTO ${TABLES.EpochStats} (
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
}


function dataCenterToKey(dc: DataCenter) {
  return `${dc.location}-${dc.asn}`;
}


async function importValidatorEpochStats(cluster: Cluster, epoch: number, epochStats: Record<string, any>) {

  const validatorClassifications = epochStats.V1.validator_classifications;

  const dataCentersInfo = epochStats.V1.data_center_info.reduce((acc, o) => {
    acc[dataCenterToKey(o.id)] = o;
    return acc;
  }, {});

  const classifications = Object.values(validatorClassifications);

  console.log(`importValidatorEpochStats(): Importing ${classifications.length} validators for ${cluster}/${epoch}`);

  for (let i = 0; i < classifications.length; i++) {
    const classification: Record<any, any> = classifications[i];

    const key = new PublicKey(classification.identity);

    const dataCenterInfo = dataCentersInfo[dataCenterToKey(classification.current_data_center)];
    const stats = {
      notes: classification.notes,
      slots: classification.slots,
      blocks: classification.blocks,
      state: classification.stake_state,
      commission: classification.commission,
      self_stake: classification.self_stake,
      state_action: classification.stake_action,
      state_reason: classification.stake_state_reason,
      vote_credits: classification.vote_credits,
      data_center_stake: dataCenterInfo.stake,
      data_center_stake_percent: dataCenterInfo.stake_percent,
      epoch_data_center: classification.current_data_center,
    }

    const match = await client.query(`SELECT id 
        FROM ${TABLES.ValidatorEpochStats}
        WHERE validator_pk=$1 AND
                epoch=$2 AND
                cluster=$3`,
      [
        key.toBase58(),
        epoch,
        cluster
      ]);

    if (match.rows.length === 1) {
      await client.query(`UPDATE ${TABLES.ValidatorEpochStats}
      SET stats = $1
      WHERE id=$2`, [
        stats,
        match.rows[0].id
      ])

    } else if (match.rows.length === 0) {
      await client.query(`INSERT INTO ${TABLES.ValidatorEpochStats}
           (
             validator_pk,
             epoch,
             cluster,
             stats
           ) VALUES (
             $1, $2, $3, $4
           )`, [
        key.toBase58(),
        epoch,
        cluster,
        stats
      ]);

    } else {
      throw new Error(`> 1 row in ${TABLES.ValidatorEpochStats} for `)
    }
  }
}


async function updateKeypairTableRow(client, participant: Participant): Promise<any> {

  const mk = participant.mainnet_identity.toBase58();
  const tk = participant.testnet_identity.toBase58();

  const matchingKeyPair = await client.query(`SELECT id, state 
    FROM ${TABLES.ValidatorKeyPair}
    WHERE mainnet_beta_pk=$1 AND
        testnet_pk=$2`,
    [
      mk,
      tk
    ]);

  if (matchingKeyPair.rows.length === 1) {
    if (matchingKeyPair.rows[0].state !== participant.state) {
      await client.query(`UPDATE ${TABLES.ValidatorKeyPair}
       SET state=$1
       WHERE id= $2`, [
        matchingKeyPair.rows[0].state,
        matchingKeyPair.rows[0].id,
      ])
    }
  } else if (matchingKeyPair.rows.length === 0) {
    await client.query(`INSERT INTO ${TABLES.ValidatorKeyPair} (
          mainnet_beta_pk,
          testnet_pk,
          state
        ) VALUES (
          $1,
          $2,
          $3
        )`, [
      mk,
      tk,
      participant.state
    ]);
  } else if (matchingKeyPair.rows.length > 1) {
    throw new Error(`> 1 rows for mn ${mk}, tn ${tk}`)
  } else {
    throw new Error(`Huh? < 0 rows? Unlikely.`);
  }
}


// async function getDelegationProgramAccounts(): Promise<Record<string, any>> {
//   const connection = await new Connection(clusterApiUrl(CLUSTERS.MAINNET_BETA))
//   return await connection.getParsedProgramAccounts(
//     DELEGATION_PROGRAM_KEY,
//   );
// }

async function pruneValidatorKeyPairTable(client, programAccounts: Participant[]): Promise<null> {
  const validatorKeyPairs = await client.query(`SELECT * from ${TABLES.ValidatorKeyPair}`);

  for (let i = 0; i < validatorKeyPairs.rows.length; i++) {
    const row = validatorKeyPairs.rows[i];
    const matches = programAccounts.find(pa => {
      return row.testnet_pk === pa.testnet_identity.toBase58() && row.mainnet_beta_pk === pa.mainnet_identity.toBase58();
    });

    if (!matches) {
      await client.query(`DELETE FROM ${TABLES.ValidatorKeyPair} WHERE id=${row.id}`)
    }
  }

  return null;
}
