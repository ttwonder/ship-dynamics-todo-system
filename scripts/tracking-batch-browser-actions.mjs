// Drive the approved selection + toolbar path through real browser input.
export const trackingBatchLabels={編輯:'批量修正',進度:'批量更新進度','送達／更正':'批量送達／更正','完工／更正':'批量完工／更正',結案:'批量結案','重開此案':'重開所選',同步到內控:'同步到內控'};
export async function trackingBatchAction({evaluate,click,nodeClick,until},reference,label){
 const row=`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.querySelector('.tracking-reference')?.innerText.includes(${JSON.stringify(reference)}))`;
 await until(()=>evaluate(`Boolean(${row})`),'source row '+reference);
 if(label==='查看內控／已同步')await nodeClick(`(${row}).querySelector('.tracking-case-link')`);
 else{
  const action=trackingBatchLabels[label];if(!action)throw Error('Unknown tracking action: '+label);
  await click('清除選取');await nodeClick(`(${row}).querySelector('.tracking-check input')`);
  await until(()=>evaluate(`[...document.querySelectorAll('.tracking-toolbar button')].some(n=>n.innerText.trim()===${JSON.stringify(action)}&&!n.disabled)`),'toolbar ready '+action);
  await click(action);
 }
 await until(()=>evaluate("Boolean(document.querySelector('[role=dialog],.modal-backdrop'))"),'tracking action '+label);
}
