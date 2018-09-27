#!/usr/bin/env bash.origin.script

pushd "projects/project" > /dev/null

    node ../../../../sourcelogic myOverlay/[project].scripts.start --silent 1

popd > /dev/null

echo "parentProject:sub2.overwrittenVarGlobal should be 'parentProject-credentialVal-by-project'"
