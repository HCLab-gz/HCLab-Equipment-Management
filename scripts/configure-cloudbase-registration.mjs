import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../cloudbaserc.json', import.meta.url)));
const cli = process.env.HCLAB_TCB_CLI || 'tcb';
function call(action, body) {
  const text = execFileSync(cli, ['api', 'tcb', action, '--api-version', '2018-06-08', '--body', JSON.stringify(body), '--json'], {encoding:'utf8'});
  return JSON.parse(text.slice(text.indexOf('{'))).data;
}
const target = { EnvId: config.envId, ResourceType: 'FUNCTION', ResourceName: config.envId };
const current = call('DescribeSecurityRule', {...target, OnlyTag:false});
const rule = JSON.parse(current.Rule);
const next = {...rule, 'hclab-register': {invoke:true}};
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({envId:config.envId, before:rule, after:next}, null, 2));
} else {
  const result = call('ModifySecurityRule', {...target, AclTag:'CUSTOM', Rule:JSON.stringify(next)});
  console.log(JSON.stringify({envId:config.envId, function:'hclab-register', updated:true, requestId:result.RequestId}));
}
