import {
    Contract,
    Gateway,
    GatewayOptions,
    InMemoryWallet,
    Network,
    X509WalletMixin
} from 'fabric-network';

import * as redis from 'redis';
import * as util from 'util';

const CLOSE_SHUTDOWN_MESSAGE: string = 'ChannelEventHub has been shutdown';
const NO_REDIS_URL_MESSAGE: string =
    'You must provide a valid Redis connection URL parameter';
const NO_CREDENTIALS_MESSAGE: string =
    'You must provide a valid credentials parameter';
const NO_CONNECTION_PROFILE_MESSAGE: string =
    'You must provide a valid connection profile parameter';

interface IProcessingResult {
    startBlock: number;
    endBlock: number;
    blockEventsProcessed: number[];
}

interface IProcessingRequest {
    redis: any;
    credentials: ICredentials;
    connectionProfile: any;
    startBlock?: number;
    endBlock?: number;
}

interface ICredentials {
    name: string;
    private_key: string;
    cert: string;
}

interface IConnectionProfile {
    name: string;
    private_key: string;
    cert: string;
}

export async function main(params: IProcessingRequest) {
    return new Promise<IProcessingResult>(async (resolve, reject) => {
        if (!params.redis) {
            console.error(NO_REDIS_URL_MESSAGE);
            return reject(new Error(NO_REDIS_URL_MESSAGE));
        }

        if (!params.credentials) {
            console.error(NO_CREDENTIALS_MESSAGE);
            return reject(new Error(NO_CREDENTIALS_MESSAGE));
        }

        if (!params.connectionProfile) {
            console.error(NO_CONNECTION_PROFILE_MESSAGE);
            return reject(new Error(NO_CONNECTION_PROFILE_MESSAGE));
        }

        const client = createRedisClient(params.redis, params.connectionProfile.name);
        console.time('client.get');
        const lastBlockSeen: number = await client.get();
        console.timeEnd('client.get');

        /**
         * Configure and connect to Blockchain
         */
        console.time('connectToBlockchain');
        const gateway: Gateway = await connectToBlockchain(
            params.credentials,
            params.connectionProfile
        );
        console.timeEnd('connectToBlockchain');

        // Always setting this to the first peer for now
        const peerName = Object.keys(params.connectionProfile.peers)[0];
        const channelName = params.connectionProfile.name;

        console.time('gateway.getNetwork');
        const network: Network = await gateway.getNetwork(channelName);
        console.timeEnd('gateway.getNetwork');

        const channel = network.getChannel();
        const eventHub = channel.getChannelEventHub(peerName);

        // Allow manual override of previous parameters stored in Redis.
        const startBlock: number = params.startBlock || lastBlockSeen + 1 || 0;

        // Find out the max block height so we know when we have completed all cycles
        console.time('getEndBlock');
        const endBlock: number = params.endBlock || await getEndBlock(channel);
        console.timeEnd('getEndBlock');

        const blockEventsProcessed: number[] = [];

        console.log(
            `Processing events for blocks between start (${startBlock}) & end (${endBlock})`
        );

        // Process new blocks only if they exist - otherwise nothing to do so exit!
        if (startBlock > endBlock) {
            resolve({ blockEventsProcessed, startBlock, endBlock });
            return;
        }

        eventHub.registerBlockEvent(
            // Have to set type to 'any' as there is a bug in the type defs
            async (newBlock: any) => {
                // Do something useful here
                //    console.log(newBlock);
                const newBlockNumber: number = parseInt(newBlock.number, 10);
                blockEventsProcessed.push(newBlockNumber);
                console.log(`Event received for block ${newBlockNumber}`);

                if (newBlockNumber === endBlock) {
                    console.log('we made it to the end!');
                    channel.close();
                }
            },
            async (err) => {
                if (err.message === CLOSE_SHUTDOWN_MESSAGE) {
                    console.time('client.set');
                    await client.set(endBlock);
                    console.timeEnd('client.set');
                    resolve({ blockEventsProcessed, startBlock, endBlock });
                } else {
                    reject(err);
                }
            },
            {
                endBlock,
                startBlock
            }
        );

        // Connect the event hub an let it do its work
        eventHub.connect({ full_block: false });
    });
}

async function connectToBlockchain(
    credentials: ICredentials,
    connectionProfile
) {
    const wallet: InMemoryWallet = new InMemoryWallet();

    // Create our identityName/identity pair
    const identityName = credentials.name ? credentials.name : 'admin';
    const identity = createIdentity(credentials);

    // Set up our gateway
    const gateway = new Gateway();
    const gatewayOptions: GatewayOptions = {
        discovery: {
            asLocalhost: false,
            enabled: true
        },
        identity: identityName,
        wallet
    };

    // Add the identityName/identity pair to the wallet
    await wallet.import(identityName, identity);

    // Establish our blockchain connection
    try {
        await gateway.connect(connectionProfile, gatewayOptions);
    } catch (err) {
        console.log('Could not conenct to Blockchain. Exiting');
        console.log(err);
        process.exit(1);
    }

    return gateway;
}

function createRedisClient(connectionDetails: any, name: string) {
    const tls = {
        ca: Buffer.from(connectionDetails.cert, 'base64').toString('utf-8')
    };

    const client = redis.createClient(connectionDetails.url, { tls });

    const get = util.promisify(client.get).bind(client);
    const set = util.promisify(client.set).bind(client);

    client.on('ready', () => console.log('redis: ready'));
    client.on('error', (err) => console.error('redis: error', err));

    return {
      get: async () => {
          const result = await get(name);
          console.log('logr esult', result);
          return result ? parseInt(result, 10) : -1;
      },
      set: async (value) => set(name, value)
    };
}

function createIdentity(credentials) {
    const cert = Buffer.from(credentials.cert, 'base64').toString();
    const privateKey = Buffer.from(
        credentials.private_key,
        'base64'
    ).toString();

    const identity = X509WalletMixin.createIdentity(
        'org1msp',
        cert,
        privateKey
    );

    return identity;
}

async function getEndBlock(channel) {
    const channelInfo = await channel.queryInfo();
    return parseInt(channelInfo.height.low, 10) - 1;
}
