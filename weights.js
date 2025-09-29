const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');

const NETUID = 1;

// List of neuron hotkeys

// SN26
const hotkeys = {
  1: [
    "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
  ],
};

let taoPrice;
let alphaPrice;

async function fetchTaoPrice() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd'
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return parseFloat(json.bittensor.usd);
  } catch (err) {
    console.error('Failed to fetch TAO price:', err);
  }
}

async function getEpochBlocks(api, netuid) {
  const blocks = (await api.query.subtensorModule.blocksSinceLastStep(netuid)).toNumber();
  return blocks;
}

async function getAllWeights(api, netuid) {
  const weights = [];
  for (let vid = 0; vid < 256; vid += 1) {
    const vweights = await api.query.subtensorModule.weights(netuid, vid);
    weights.push(vweights);
  }
  return weights;
}

async function getWeights(api, netuid, hotkey, allWeights) {
  const uid = parseInt(await api.query.subtensorModule.uids(netuid, hotkey));

  // Get pruning scores
  const pruningScores = await api.query.subtensorModule.pruningScores(netuid);
  const myps = parseInt(pruningScores[uid]);
  let lowerCount = 0;
  for (let i = 0; i < pruningScores.length; i += 1) {
    if (parseInt(pruningScores[i]) < myps) {
      lowerCount += 1;
    }
  }
  const pruningRisk = lowerCount < 10 ? '⚠️  High' : 'Low';

  // Get incentive and emission
  const incentives = await api.query.subtensorModule.incentive(netuid);
  const incentive = parseInt(incentives[uid]);

  const emissions = await api.query.subtensorModule.emission(netuid);
  const emission = parseInt(emissions[uid]) / 1e9;
  const alphaPerEpoch = emission;
  const alphaPerDay = emission * 20;
  const taoPerDay = alphaPrice * emission * 20;
  const usdPerDay = alphaPrice * emission * 20 * taoPrice;

  if (Number.isNaN(usdPerDay)) {
    return {
      uid:"n/a",
      hotkey,
      pruningScore: 0,
      pruningRisk: "dereged",
      incentive: 0,
      alphaPerEpoch: 0,
      alphaPerDay: 0,
      taoPerDay: 0,
      usdPerDay: 0,
    };
  }

  return {
    uid,
    hotkey,
    pruningScore: myps,
    pruningRisk,
    incentive,
    alphaPerEpoch,
    alphaPerDay,
    taoPerDay,
    usdPerDay,
  };
}

function formatFutureTime(secondsFromNow) {
  const future = new Date(Date.now() + secondsFromNow * 1000);
  return future.toLocaleString(); // Uses local timezone and human-readable format
}

async function main() {
    const host = 'entrypoint-finney.opentensor.ai';
    const port = 443;
    const url = `wss://${host}:${port}`;

    // const host = 'localhost';
    // const port = 9944;
    // const url = `ws://${host}:${port}`;

    // Create api and wait
    const wsProvider = new WsProvider(url);
    const api = await ApiPromise.create({ provider: wsProvider });
    await api.isReady;
    console.log("----------------\n\nConnected!");

    // Get TAO price
    taoPrice = await fetchTaoPrice();
    console.log(`TAO price: $${taoPrice.toFixed(2)}`);

    // Get alpha price
    const subnetTao = await api.query.subtensorModule.subnetTAO(NETUID);
    const subnetAlphaIn = await api.query.subtensorModule.subnetAlphaIn(NETUID);
    alphaPrice = parseFloat(subnetTao) / parseFloat(subnetAlphaIn);
    console.log(`alphaPrice = ${alphaPrice.toFixed(6)}`);

    // Get epoch blocks
    const blocks = await getEpochBlocks(api, NETUID);
    console.log(`Blocks since last epoch: ${blocks}`);
    console.log(`Next epoch: ${formatFutureTime((361 - blocks) * 12)}`)

    // Read all weights
    // console.log(`Reading weights...`);
    // const allWeights = await getAllWeights(api, NETUID);
    const allWeights = {};

    let totalUsdDaily = 0;
    let totalTaoDaily = 0;
    let totalAlphaDaily = 0;

    const rows = [];
    for (const hotkey of hotkeys[NETUID]) {
      const row = await getWeights(api, NETUID, hotkey, allWeights);
      if (row) rows.push(row);

      totalUsdDaily += row.usdPerDay;
      totalTaoDaily += row.taoPerDay;
      totalAlphaDaily += row.alphaPerDay;
    }

    // Print table
    console.table(
      rows.map(r => ({
        UID: r.uid,
        Hotkey: r.hotkey,
        'Pruning Score': r.pruningScore,
        'Pruning Risk': r.pruningRisk,
        'Incentive': r.incentive,
        'Alpha/Epoch': r.alphaPerEpoch.toFixed(4),
        'Alpha/Day': parseInt(r.alphaPerDay),
        'USD/Day': `$${r.usdPerDay.toFixed(2)}`,
      }))
    );

    console.log("------");
    console.log(`Total USD daily:    $${totalUsdDaily.toFixed(2)}`);
    console.log(`Total TAO daily:     ${totalTaoDaily.toFixed(2)}`);
    console.log(`Total Alpha daily:   ${totalAlphaDaily.toFixed(2)}`);

    console.log(`\n`);
    await api.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit();
});