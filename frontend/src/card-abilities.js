/** Public card-face labels derived from docs/game-rules.md §2 and §7.
 * This module must only be used when a card value is already visible to the viewer.
 */
const PEEK=Object.freeze({
 key:'peek',name:'Peek',label:'看自己',effect:'秘密查看自己 1 张背面牌'
});
const SPY=Object.freeze({
 key:'spy',name:'Spy',label:'看对手',effect:'秘密查看其他玩家 1 张背面牌'
});
const SWAP=Object.freeze({
 key:'swap',name:'Swap',label:'交换牌',effect:'与任一玩家交换 1 张牌，正反面保持不变'
});
export function cardAbility(value){
 if(!Number.isInteger(value))return null;
 if(value>=7&&value<=8)return PEEK;
 if(value>=9&&value<=10)return SPY;
 if(value>=11&&value<=12)return SWAP;
 return null;
}
export const abilityLegendMarkup='<div class="ability-legend" role="group" aria-label="功能牌说明">'+
 '<span class="ability-legend-title">功能牌</span>'+
 '<span><b>7–8 Peek</b> 查看自己 1 张背面牌</span>'+
 '<span><b>9–10 Spy</b> 查看其他玩家 1 张背面牌</span>'+
 '<span><b>11–12 Swap</b> 与任一玩家交换 1 张牌，正反面保持</span>'+
 '<span class="ability-legend-note">仅从抽牌堆抽到并弃掉时发动；弃牌堆取牌不触发</span>'+
 '</div>';