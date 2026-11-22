/** Operational location fields are free text, not a geocoder. Keep these positive
 * port/area aliases bounded. In particular SA/AE/IR alone do not establish
 * which coast, and e.g. Portland or Newcastle alone do not establish Australia. */
export type BriefRegion = '波斯灣' | '澳洲' | '中國';

const areas: Record<BriefRegion, { latin: RegExp; han: RegExp }> = {
  波斯灣: {

    latin: /\b(?:persian gulf|arabian gulf|sohar|ras (?:tanura|tannura|laffan)|juaymah|jubail|dammam|al ahmadi|mina al ahmadi|mina abdullah|shuaiba|shuwaikh|al zour|kuwait|qatar|bahrain|doha|mesaieed|umm said|sitra|mina salman|dubai|jebel ali|abu dhabi|ruwais|das island|zirku island|umm qasr|basrah?|kharg island|bandar (?:abbas|imam khomeini)|bushehr|asaluyeh|assaluyeh)\b/i,
    han: /波斯灣|波斯湾|阿拉伯灣|阿拉伯湾|科威特|卡達|卡塔爾|卡塔尔|巴林|杜哈|多哈|杜拜|迪拜|阿布達比|阿布扎比|朱拜勒|達曼|达曼|拉斯坦努拉|傑貝阿里|杰贝阿里/,
  },
  澳洲: {
    latin: /\b(?:australia|australian waters|port hedland|dampier|cape lambert|cape preston|hay ?point|dalrymple bay|gladstone|abbot point|weipa|gove|fremantle|kwinana|geraldton|esperance|port kembla|port walcott|brisbane|melbourne|adelaide|karratha|port pirie)\b/i,
    han: /澳洲|澳大利亞|澳大利亚|黑德蘭|黑德兰|海德蘭|海德兰|丹皮爾|丹皮尔|弗里曼特爾|布里斯本|墨爾本|墨尔本|坎布拉港/,
  },
  中國: {
    latin: /\b(?:china|mainland chinese waters|shanghai|ningbo|zhoushan|qingdao|tianjin|xingang|dalian|guangzhou|nansha|shenzhen|shekou|yantian|xiamen|zhanjiang|rizhao|caofeidian|huanghua|tangshan|bayuquan|yingkou|lianyungang|fangchenggang|fangcheng|qinzhou|quanzhou|fuzhou|maoming|nanjing|nantong|taicang|dongjiakou|yantai|weihai|jiangyin|taizhou|zhangjiagang|qinhuangdao)\b/i,
    han: /中國|中国|上海|寧波|宁波|舟山|青島|青岛|天津|大連|大连|廣州|广州|深圳|蛇口|鹽田|盐田|廈門|厦门|湛江|日照|曹妃甸|黃驊|黄骅|唐山|鯨魚圈|鮁魚圈|鲅鱼圈|營口|营口|連雲港|连云港|防城港|欽州|钦州|泉州|福州|茂名|南京|南通|太倉|太仓|董家口|煙台|煙臺|烟台|威海|江陰|江阴|張家港|张家港|秦皇島|秦皇岛/,
  },
};

// Additional operational coverage, not a geographical redefinition of the Gulf.
// For Red Sea countries with another coast, match the port, not the country.
const gulfVicinity = [
  /\b(?:fujairah|fujayrah|fujeirah|fujaira|oman|muscat|matrah|muttrah|mina al fahal|salalah|duqm|khasab|qalhat|shinas|sohar|suhar|port sultan qaboos)\b/i,
  /富[加查吉賈](?:伊)?拉|富查伊哈|阿曼|馬斯喀特|马斯喀特|塞拉萊|塞拉莱|薩拉拉|萨拉拉|杜庫姆|杜库姆|蘇哈爾|苏哈尔/,
  /\b(?:red sea ports?|jeddah|jiddah|yanbu(?:['’]? al bahr)?|jizan|jazan|gizan|duba|dhuba|rabigh|king abdullah port|shuqaiq|neom port|port of neom|aqaba|aqabah|eilat|elat|suez(?!\s+canal)|(?:ain|ayn|ein) (?:el |al )?so[kh]*na|adabiya[h]?|safaga|hurghada|sharm (?:el |al )?sheikh|nuweiba|el quseir|marsa alam|port sudan|suakin|sawakin|massawa|mitsiwa|assab|aseb|hodeidah|hodeida|hudaydah|hudaidah|hod[eai]idah|salif|saleef|ras isa|mokha|mukha|mocha)\b/i,
  /[紅红]海(?:內|内|沿岸)?港|吉[達达]|[延彥彦揚扬]布|吉[贊赞]港|吉[瓚瓒]港|阿卜杜拉國王港|阿卜杜拉国王港|亞喀巴|亚喀巴|埃拉特|[蘇苏]伊士(?:港|$)|艾因(?:蘇赫納|苏赫纳)|薩法加|萨法加|[蘇苏]丹港|[薩萨]瓦金|馬薩瓦|马萨瓦|阿薩布|阿萨布|荷[臺台]達|荷[臺台]达|荷[臺台]德|荷[臺台]第|霍[臺台]達|霍[臺台]达|摩卡港/,
  /\b(?:OM|OM(?:MCT|SLL|DQM|SOH|KHS|FAH|QAL)|AE\s?FJR|SA\s?(?:JED|YNB|GIZ|DHU|KAC)|EG\s?(?:SUZ|SOK|SGA|HRG)|JO\s?AQJ|IL\s?ETH|SD\s?(?:PZU|SWN)|ER\s?(?:MSW|ASA)|YE\s?(?:HOD|SAL|MOK))\b/i,
];
// Compact or space-separated LOCODEs for the Gulf itself.
const gulfCodes = /\b(?:OM\s?SOH|AE\s?(?:JEA|DXB|AUH|RUW)|SA\s?(?:RTA|JUB|DMM)|IR\s?(?:BND|BIK|BUZ)|(?:KW|QA|BH|IQ)(?:\s?[A-Z2-9]{3})?)\b/;

export function matchesBriefRegion(region: BriefRegion, location: string): boolean {
  let text = location.normalize('NFKC').trim();
  if (!text) return false;
  // Do not turn a route's origin, or a named sea outside port jurisdiction, into a port call.
  text = text.split(/\s*(?:→|->|⇒)\s*/).pop()!.replace(/^.*\bfrom\b.*?\bto\s+/i, '');
  text = text.split(/\b(?:from|departed|previous(?:ly)?|last port|ex[- ])\b|上一港|前一港/i)[0];
  if (region === '中國') text = text.replace(/\b(?:south|east) china sea\b|\btaiwan\s*[,(/-]?\s*(?:province of china|republic of china)|\brepublic of china\s*\(taiwan\)/gi, '').replace(/南中國海|南中国海|東中國海|东中国海/g, '');
  const {latin, han} = areas[region];
  if (latin.test(text) || han.test(text)) return true;
  if (region==='波斯灣' && gulfVicinity.some(alias=>alias.test(text))) return true;
  // A standalone ISO code qualifies, but a random five-letter word (e.g. AUDIO)
  // is not a UN/LOCODE. Allow only known port suffixes in the compact spelling.
  return region === '波斯灣' ? gulfCodes.test(text)
    : region === '澳洲' ? /\b(?:AUS|AU|AU(?:PHE|HPT|DMP|NTL|SYD|BNE|MEL|FRE|PKL|GLT|ADL|DBY|GET|ESP|DRW|WAL|KWI))\b/.test(text)
    : /\b(?:CHN|CN|CN(?:SHA|NGB|TAO|TSN|XGG|DLC|ZOS|ZSN|CAN|NAN|SZX|SHK|YTN|XMN|ZHA|RZH|CFD|BYQ|LYG|FAN|QZH|FOC|NTG|YNT|TAZ|ZJG|SHP))\b/.test(text);
}
