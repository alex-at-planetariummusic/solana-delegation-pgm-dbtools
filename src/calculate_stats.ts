import client from './utils/client';
import {QueryResult} from "pg";
import {EpochStat, getMostRecentEpochInDBForCluster, TABLES} from "./utils/db_utils";


// "main"
(async () => {
  await client.connect();

  const validatorStats: QueryResult = await client.query(`SELECT * from ${TABLES.ValidatorStats}`);

  for (const row of validatorStats.rows) {
    console.log(`calculating for ${row.validator_pk}`);
    const validatorEpochStats = await getValidatorEpochStats(row.validator_pk)
    if (validatorEpochStats.length === 0) {
      console.log(`No epoch stats for ${row.validator_pk}`);
      continue;
    }

    const validatorStats = await calculateValidatorEpochStats(validatorEpochStats);
    const calculatedStats = await calculateValidatorStats(row, validatorEpochStats, validatorStats);

    await client.query(`UPDATE ${TABLES.ValidatorStats} SET calculated_stats=$1, stats=$2 WHERE id=$3`,
      [calculatedStats, validatorStats, row.id])
  }

  console.log('DONE!');
  process.exit(0);
})()

async function getValidatorEpochStats(validator_pk: String): Promise<Record<string, any>[]> {
  const result: QueryResult = await client.query(
    `SELECT * FROM ${TABLES.ValidatorEpochStats}
     WHERE validator_pk=$1
     ORDER BY epoch`,
    [validator_pk]
  )
  return result.rows;
}


async function calculateValidatorEpochStats(validatorEpochStats: Record<string, any>[]) {
  const stats = {
    epochs: {}
  }
  for (const epochStat of validatorEpochStats) {
    if (epochStat.epoch === 208 && epochStat.cluster === 'testnet') {
      // console.log('skipping:', epochStat.cluster, epochStat.epoch);
    } else {
      stats.epochs[epochStat.epoch] = epochStat.stats.state
    }
  }
  // console.log(stats)

  return stats;
}


async function calculateValidatorStats(validatorStat: Record<string, any>, validatorEpochStats: Record<string, any>[], validatorStats: Record<string, any>) {
  const sums = {
    skip_rate: 0,
    self_stake: 0,
    num_bonus_last_10: 0,
  };

  const mostRecentEpoch = await getMostRecentEpochInDBForCluster(validatorStat.cluster)

  let numberSkiprateMeasurements = 0;
  let numberSelfStakeMeasurements = 0;
  for (const epochStat of validatorEpochStats) {

    if (epochStat.epoch === 208 && epochStat.cluster === 'testnet') {
      continue;
    }
    if (typeof epochStat.stats.blocks === 'number' && typeof epochStat.stats.slots === 'number') {
      numberSkiprateMeasurements++;
      sums.skip_rate = sums.skip_rate + skipRate(epochStat.stats.blocks, epochStat.stats.slots)
    }

    if (epochStat.stats.self_stake !== undefined) {
      numberSelfStakeMeasurements++;
      sums.self_stake = sums.self_stake + epochStat.stats.self_stake;
    }
    if (epochStat.epoch > mostRecentEpoch - 10 && epochStat.stats.state === EpochStat.Bonus) {
      sums.num_bonus_last_10++
    }
  }

  const stats = calculatePerformance(Object.values(validatorStats.epochs))
  stats.num_bonus_last_10 = sums.num_bonus_last_10;
  if (numberSkiprateMeasurements > 0) {
    stats.avg_skip_rate = sums.skip_rate / numberSkiprateMeasurements;
  }
  if (numberSelfStakeMeasurements > 0) {
    stats.avg_self_stake = sums.self_stake / numberSelfStakeMeasurements
  }
  // console.log(stats)

  return stats
}

function skipRate(blocks: number, slots: number): number {
  return 100 - blocks * 100 / slots
}


function calculatePerformance(epochStats: EpochStat[]): Record<string, any> {
  const num_bonus = epochStats.filter(es => es === EpochStat.Bonus).length;
  const num_baseline = epochStats.filter(es => es === EpochStat.Baseline).length;

  return {
    bonus_epochs_percent: 100 * num_bonus / epochStats.length,
    bonus_and_baseline_percent: 100 * (num_baseline + num_bonus) / epochStats.length
  }

}
