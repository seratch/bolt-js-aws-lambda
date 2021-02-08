#!/bin/bash

current_dir=`dirname $0`
cd ${current_dir}
rm -f bolt-aws-lambda-*.tgz
rm -rf ${current_dir}/dist
npm run build && npm pack
