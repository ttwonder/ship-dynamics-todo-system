import assert from 'node:assert/strict';

// Operate Chromium's native date segments; never assign DOM/React values.
export async function fillNativeDate(evaluate,dispatch,selector,value){
  const [year,month,day]=value.split('-').map(Number);
  const press=async key=>{
    const digit=/^[0-9]$/.test(key);
    const p={key,code:digit?'Digit'+key:key,windowsVirtualKeyCode:digit?key.charCodeAt(0):({ArrowLeft:37,ArrowRight:39,ArrowUp:38,Home:36,Backspace:8,Tab:9})[key],...(digit?{text:key,unmodifiedText:key}:{})};
    await dispatch('Input.dispatchKeyEvent',{type:'keyDown',...p});await dispatch('Input.dispatchKeyEvent',{type:'keyUp',...p});
  };
  await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.type!=='date'||n.disabled)throw Error('date input unavailable');n.focus();})()`);
  for(let i=0;i<3;i++)await press('ArrowLeft');
  await press('Backspace');for(let i=0;i<month;i++)await press('ArrowUp');
  await press('ArrowRight');await press('Backspace');for(let i=0;i<day;i++)await press('ArrowUp');
  await press('ArrowRight');await press('Backspace');for(const digit of String(year))await press(digit);await press('Tab');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),value,'native date segments must produce the requested ISO date');
}
