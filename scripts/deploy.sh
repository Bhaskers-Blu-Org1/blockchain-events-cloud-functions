#!/bin/bash

set -uex

# Install and build
npm install
npm run build

# NPM modules with native deps need to be compiled for openwhisk runtime
# Re-install node_modules using correct docker runtime container
mv node_modules temp_node_modules
docker run -it -v $PWD:/nodejsAction openwhisk/action-nodejs-v10 npm install --production

# create action package from action code + deps
zip -r action.zip dist/ node_modules/ package.json

# move old node_modules back into place
mv temp_node_modules node_modules

ibmcloud wsk action update blockchain -p credentials "$(< ./credentials/OrgUser.json)" \
  -p connectionProfile "$(< ./credentials/ConnectionProfile.json)" \
  -p redis "$(< ./credentials/redis.json)" --kind nodejs:10 action.zip
