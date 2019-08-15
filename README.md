# IBM Cloud Functions and IBM Blockchain Platform

This repository contains code samples which demonstrate how to process blockchain events from the IBM Blockchain Platform (Hyperledger Fabric) from IBM Cloud Functions (Apache OpenWhisk). The instructions show how to set up a sample Cloud Functions that will process all new block events from the blockchain since the last invocation. Connecting this function to the cron alarm trigger event will automatically run it once a minute to process all new events. Processed events state is stored in Redis between invocations. 

## instructions for usage

### prerequisites

- IBM Cloud account.
- IBM Cloud CLI installed.
- IBM Cloud Functions CLI plugin installed.
- Instance of the IBM Blockchain platform.
- Redis instance provisioned.

### create service credential files

- Retrieve service credentials for the IBM Blockchain Platform and Redis instance.

- Replace the following JSON configuration files in the `credentials` directory with the correct service credentials. 
  -  `ConnectionProfile.json`: This should be downloaded from the 'Smart contracts' tab in the IBM Blockchain Platform 2.0 UI for an [instantiated smart contract](https://cloud.ibm.com/docs/services/blockchain/howto?topic=blockchain-ibp-console-smart-contracts#ibp-console-smart-contracts-connect-to-SDK-panel) .
  -  `OrgUser.json`: This can be generated / downloaded from the IBM Blockchain Platform 2.0 UI for a given [enrolled identity](https://cloud.ibm.com/docs/services/blockchain/howto?topic=blockchain-ibp-console-identities)
  - `redis.json` Connection JSON for the Redis Node.js client 

### run the deploy script

- Run the deployment script which will create a new action in the current namespace called `blockchain`.

  ```
  npm run deploy
  ```

### test the action

- Invoke the action to process all previous events. The action has two (optional) parameters: `startBlock` and `endBlock`. If this aren't specified, they default to `0` and the highest current block on the chain.

  ```
  ibmcloud wsk action invoke blockchain -r
  ```

  ```
  {
      "blockEventsProcessed": [1, 2, 3...],
      "startBlock": 1
      "endBlock": 100,
  }
  ```

Block numbers for processed events will be returned in the action response. The highest block number processed will be stored in Redis (using the `connectionProfile.name` property as the key). This will be used as the `startBlock` value on the next action invocation to ensure events are only processed once.

- Invoking the action again should return no new processed events

  ```
  ibmcloud wsk action invoke blockchain -r
  ```

### connect to alarm trigger

- Create a new trigger using the alarm feed to be called once a minute.

  ```
  ibmcloud wsk trigger create once-a-min --feed /whisk.system/alarms/interval -p minutes 1
  ```

- Create a new rule binding the action to the trigger.

  ```
  ibmcloud wsk rule create process-blockchain-events once-a-min blockchain
  ```

- Monitor the activation logs for IBM Cloud Functions to see the action being invoked.

  ```
  ibmcloud wsk activation poll
  ```

## details on implementation

### reading events from the blockchain

IBM Cloud Functions does not have an event feed for The Blockchain Platform. Instead, we run a function once a minute (using the alarm trigger feed) which manually replays blockchain events, using explicit `startBlock` and `endBlock` parameters to retrieve events that occurred between invocations.

The `startBlock` parameter is set to the previously seen `endBlock` from the last invocation (which is persisted in Redis between invocations). The `endBlock` parameter is set to the [current blockchain height](https://github.ibm.com/ash/openwhisk-eventhub/blob/master/src/index.ts#L232-L235).

Since the `eventHub.registerBlockEvent` [method](https://github.ibm.com/ash/openwhisk-eventhub/blob/master/src/index.ts#L110-L138) used to listen to blockchain events uses a callback-based approach, the `endBlock` number is used to determine when the last block event has been processed. This allows the code to close the connection channel before finishing.

Before completing the invocation, the `endBlock` status [is updated](https://github.ibm.com/ash/openwhisk-eventhub/blob/master/src/index.ts#L125-L129) in the persistence store (Redis). The channel close message is used as the trigger to return from the invocation handler.

### compiling NPM dependencies for cloud functions

The `fabric-network` NPM module uses native Node.js module dependencies like GPRC. These dependencies need to be compiled for the platform runtime, rather than the development machine. [There's a script](https://github.ibm.com/ash/openwhisk-eventhub/blob/master/scripts/deploy.sh) which automatically handles compiling the production dependencies using Docker and creating the `blockchain` action.
