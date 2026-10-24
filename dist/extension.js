"use strict";var fs=Object.create;var Pt=Object.defineProperty;var ms=Object.getOwnPropertyDescriptor;var gs=Object.getOwnPropertyNames;var hs=Object.getPrototypeOf,vs=Object.prototype.hasOwnProperty;var Ie=(e,t)=>()=>(e&&(t=e(e=0)),t);var fe=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),bt=(e,t)=>{for(var r in t)Pt(e,r,{get:t[r],enumerable:!0})},on=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let i of gs(t))!vs.call(e,i)&&i!==r&&Pt(e,i,{get:()=>t[i],enumerable:!(n=ms(t,i))||n.enumerable});return e};var y=(e,t,r)=>(r=e!=null?fs(hs(e)):{},on(t||!e||!e.__esModule?Pt(r,"default",{value:e,enumerable:!0}):r,e)),ys=e=>on(Pt({},"__esModule",{value:!0}),e);var st=fe(Pe=>{"use strict";var cn=":A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD",Ss=cn+"\\-.\\d\\u00B7\\u0300-\\u036F\\u203F-\\u2040",ln="["+cn+"]["+Ss+"]*",Ps=new RegExp("^"+ln+"$"),bs=function(e,t){let r=[],n=t.exec(e);for(;n;){let i=[];i.startIndex=t.lastIndex-n[0].length;let o=n.length;for(let s=0;s<o;s++)i.push(n[s]);r.push(i),n=t.exec(e)}return r},Cs=function(e){let t=Ps.exec(e);return!(t===null||typeof t>"u")};Pe.isExist=function(e){return typeof e<"u"};Pe.isEmptyObject=function(e){return Object.keys(e).length===0};Pe.merge=function(e,t,r){if(t){let n=Object.keys(t),i=n.length;for(let o=0;o<i;o++)r==="strict"?e[n[o]]=[t[n[o]]]:e[n[o]]=t[n[o]]}};Pe.getValue=function(e){return Pe.isExist(e)?e:""};var xs=["hasOwnProperty","toString","valueOf","__defineGetter__","__defineSetter__","__lookupGetter__","__lookupSetter__"],ks=["__proto__","constructor","prototype"];Pe.isName=Cs;Pe.getAllMatches=bs;Pe.nameRegexp=ln;Pe.DANGEROUS_PROPERTY_NAMES=xs;Pe.criticalProperties=ks});var ir=fe(mn=>{"use strict";var nr=st(),Ns={allowBooleanAttributes:!1,unpairedTags:[]};mn.validate=function(e,t){t=Object.assign({},Ns,t);let r=[],n=!1,i=!1;e[0]==="\uFEFF"&&(e=e.substr(1));for(let o=0;o<e.length;o++)if(e[o]==="<"&&e[o+1]==="?"){if(o+=2,o=dn(e,o),o.err)return o}else if(e[o]==="<"){let s=o;if(o++,e[o]==="!"){o=un(e,o);continue}else{let a=!1;e[o]==="/"&&(a=!0,o++);let c="";for(;o<e.length&&e[o]!==">"&&e[o]!==" "&&e[o]!=="	"&&e[o]!==`
`&&e[o]!=="\r";o++)c+=e[o];if(c=c.trim(),c[c.length-1]==="/"&&(c=c.substring(0,c.length-1),o--),!Is(c)){let p;return c.trim().length===0?p="Invalid space after '<'.":p="Tag '"+c+"' is an invalid name.",K("InvalidTag",p,ae(e,o))}let l=Ts(e,o);if(l===!1)return K("InvalidAttr","Attributes for '"+c+"' have open quote.",ae(e,o));let u=l.value;if(o=l.index,u[u.length-1]==="/"){let p=o-u.length;u=u.substring(0,u.length-1);let d=fn(u,t);if(d===!0)n=!0;else return K(d.err.code,d.err.msg,ae(e,p+d.err.line))}else if(a)if(l.tagClosed){if(u.trim().length>0)return K("InvalidTag","Closing tag '"+c+"' can't have attributes or invalid starting.",ae(e,s));if(r.length===0)return K("InvalidTag","Closing tag '"+c+"' has not been opened.",ae(e,s));{let p=r.pop();if(c!==p.tagName){let d=ae(e,p.tagStartPos);return K("InvalidTag","Expected closing tag '"+p.tagName+"' (opened in line "+d.line+", col "+d.col+") instead of closing tag '"+c+"'.",ae(e,s))}r.length==0&&(i=!0)}}else return K("InvalidTag","Closing tag '"+c+"' doesn't have proper closing.",ae(e,o));else{let p=fn(u,t);if(p!==!0)return K(p.err.code,p.err.msg,ae(e,o-u.length+p.err.line));if(i===!0)return K("InvalidXml","Multiple possible root nodes found.",ae(e,o));t.unpairedTags.indexOf(c)!==-1||r.push({tagName:c,tagStartPos:s}),n=!0}for(o++;o<e.length;o++)if(e[o]==="<")if(e[o+1]==="!"){o++,o=un(e,o);continue}else if(e[o+1]==="?"){if(o=dn(e,++o),o.err)return o}else break;else if(e[o]==="&"){let p=Fs(e,o);if(p==-1)return K("InvalidChar","char '&' is not expected.",ae(e,o));o=p}else if(i===!0&&!pn(e[o]))return K("InvalidXml","Extra text at the end",ae(e,o));e[o]==="<"&&o--}}else{if(pn(e[o]))continue;return K("InvalidChar","char '"+e[o]+"' is not expected.",ae(e,o))}if(n){if(r.length==1)return K("InvalidTag","Unclosed tag '"+r[0].tagName+"'.",ae(e,r[0].tagStartPos));if(r.length>0)return K("InvalidXml","Invalid '"+JSON.stringify(r.map(o=>o.tagName),null,4).replace(/\r?\n/g,"")+"' found.",{line:1,col:1})}else return K("InvalidXml","Start tag expected.",1);return!0};function pn(e){return e===" "||e==="	"||e===`
`||e==="\r"}function dn(e,t){let r=t;for(;t<e.length;t++)if(e[t]=="?"||e[t]==" "){let n=e.substr(r,t-r);if(t>5&&n==="xml")return K("InvalidXml","XML declaration allowed only at the start of the document.",ae(e,t));if(e[t]=="?"&&e[t+1]==">"){t++;break}else continue}return t}function un(e,t){if(e.length>t+5&&e[t+1]==="-"&&e[t+2]==="-"){for(t+=3;t<e.length;t++)if(e[t]==="-"&&e[t+1]==="-"&&e[t+2]===">"){t+=2;break}}else if(e.length>t+8&&e[t+1]==="D"&&e[t+2]==="O"&&e[t+3]==="C"&&e[t+4]==="T"&&e[t+5]==="Y"&&e[t+6]==="P"&&e[t+7]==="E"){let r=1;for(t+=8;t<e.length;t++)if(e[t]==="<")r++;else if(e[t]===">"&&(r--,r===0))break}else if(e.length>t+9&&e[t+1]==="["&&e[t+2]==="C"&&e[t+3]==="D"&&e[t+4]==="A"&&e[t+5]==="T"&&e[t+6]==="A"&&e[t+7]==="["){for(t+=8;t<e.length;t++)if(e[t]==="]"&&e[t+1]==="]"&&e[t+2]===">"){t+=2;break}}return t}var $s='"',As="'";function Ts(e,t){let r="",n="",i=!1;for(;t<e.length;t++){if(e[t]===$s||e[t]===As)n===""?n=e[t]:n!==e[t]||(n="");else if(e[t]===">"&&n===""){i=!0;break}r+=e[t]}return n!==""?!1:{value:r,index:t,tagClosed:i}}var Es=new RegExp(`(\\s*)([^\\s=]+)(\\s*=)?(\\s*(['"])(([\\s\\S])*?)\\5)?`,"g");function fn(e,t){let r=nr.getAllMatches(e,Es),n={};for(let i=0;i<r.length;i++){if(r[i][1].length===0)return K("InvalidAttr","Attribute '"+r[i][2]+"' has no space in starting.",at(r[i]));if(r[i][3]!==void 0&&r[i][4]===void 0)return K("InvalidAttr","Attribute '"+r[i][2]+"' is without value.",at(r[i]));if(r[i][3]===void 0&&!t.allowBooleanAttributes)return K("InvalidAttr","boolean attribute '"+r[i][2]+"' is not allowed.",at(r[i]));let o=r[i][2];if(!Ms(o))return K("InvalidAttr","Attribute '"+o+"' is an invalid name.",at(r[i]));if(!n.hasOwnProperty(o))n[o]=1;else return K("InvalidAttr","Attribute '"+o+"' is repeated.",at(r[i]))}return!0}function Rs(e,t){let r=/\d/;for(e[t]==="x"&&(t++,r=/[\da-fA-F]/);t<e.length;t++){if(e[t]===";")return t;if(!e[t].match(r))break}return-1}function Fs(e,t){if(t++,e[t]===";")return-1;if(e[t]==="#")return t++,Rs(e,t);let r=0;for(;t<e.length;t++,r++)if(!(e[t].match(/\w/)&&r<20)){if(e[t]===";")break;return-1}return t}function K(e,t,r){return{err:{code:e,msg:t,line:r.line||r,col:r.col}}}function Ms(e){return nr.isName(e)}function Is(e){return nr.isName(e)}function ae(e,t){let r=e.substring(0,t).split(/\r?\n/);return{line:r.length,col:r[r.length-1].length+1}}function at(e){return e.startIndex+e[1].length}});var wn=fe(or=>{var{DANGEROUS_PROPERTY_NAMES:gn,criticalProperties:js}=st(),hn=e=>gn.includes(e)?"__"+e:e,vn={preserveOrder:!1,attributeNamePrefix:"@_",attributesGroupName:!1,textNodeName:"#text",ignoreAttributes:!0,removeNSPrefix:!1,allowBooleanAttributes:!1,parseTagValue:!0,parseAttributeValue:!1,trimValues:!0,cdataPropName:!1,numberParseOptions:{hex:!0,leadingZeros:!0,eNotation:!0},tagValueProcessor:function(e,t){return t},attributeValueProcessor:function(e,t){return t},stopNodes:[],alwaysCreateTextNode:!1,isArray:()=>!1,commentPropName:!1,unpairedTags:[],processEntities:!0,htmlEntities:!1,ignoreDeclaration:!1,ignorePiTags:!1,transformTagName:!1,transformAttributeName:!1,updateTag:function(e,t,r){return e},captureMetaData:!1,maxNestedTags:100,strictReservedNames:!0,onDangerousProperty:hn};function Ls(e,t){if(typeof e!="string")return;let r=e.toLowerCase();if(gn.some(n=>r===n.toLowerCase()))throw new Error(`[SECURITY] Invalid ${t}: "${e}" is a reserved JavaScript keyword that could cause prototype pollution`);if(js.some(n=>r===n.toLowerCase()))throw new Error(`[SECURITY] Invalid ${t}: "${e}" is a reserved JavaScript keyword that could cause prototype pollution`)}function yn(e){return typeof e=="boolean"?{enabled:e,maxEntitySize:1e4,maxExpansionDepth:10,maxTotalExpansions:1e3,maxExpandedLength:1e5,allowedTags:null,tagFilter:null}:typeof e=="object"&&e!==null?{enabled:e.enabled!==!1,maxEntitySize:Math.max(1,e.maxEntitySize??1e4),maxExpansionDepth:Math.max(1,e.maxExpansionDepth??1e4),maxTotalExpansions:Math.max(1,e.maxTotalExpansions??1/0),maxExpandedLength:Math.max(1,e.maxExpandedLength??1e5),maxEntityCount:Math.max(1,e.maxEntityCount??1e3),allowedTags:e.allowedTags??null,tagFilter:e.tagFilter??null}:yn(!0)}var Os=function(e){let t=Object.assign({},vn,e),r=[{value:t.attributeNamePrefix,name:"attributeNamePrefix"},{value:t.attributesGroupName,name:"attributesGroupName"},{value:t.textNodeName,name:"textNodeName"},{value:t.cdataPropName,name:"cdataPropName"},{value:t.commentPropName,name:"commentPropName"}];for(let{value:n,name:i}of r)n&&Ls(n,i);return t.onDangerousProperty===null&&(t.onDangerousProperty=hn),t.processEntities=yn(t.processEntities),t};or.buildOptions=Os;or.defaultOptions=vn});var Pn=fe((rp,Sn)=>{"use strict";var sr=class{constructor(t){this.tagname=t,this.child=[],this[":@"]={}}add(t,r){t==="__proto__"&&(t="#__proto__"),this.child.push({[t]:r})}addChild(t){t.tagname==="__proto__"&&(t.tagname="#__proto__"),t[":@"]&&Object.keys(t[":@"]).length>0?this.child.push({[t.tagname]:t.child,":@":t[":@"]}):this.child.push({[t.tagname]:t.child})}};Sn.exports=sr});var xn=fe((np,Cn)=>{var bn=st(),ar=class{constructor(t){this.suppressValidationErr=!t,this.options=t||{}}readDocType(t,r){let n=Object.create(null),i=0;if(t[r+3]==="O"&&t[r+4]==="C"&&t[r+5]==="T"&&t[r+6]==="Y"&&t[r+7]==="P"&&t[r+8]==="E"){r=r+9;let o=1,s=!1,a=!1,c="";for(;r<t.length;r++)if(t[r]==="<"&&!a){if(s&&Ge(t,"!ENTITY",r)){r+=7;let l,u;if([l,u,r]=this.readEntityExp(t,r+1,this.suppressValidationErr),u.indexOf("&")===-1){if(this.options.enabled!==!1&&this.options.maxEntityCount!=null&&i>=this.options.maxEntityCount)throw new Error(`Entity count (${i+1}) exceeds maximum allowed (${this.options.maxEntityCount})`);let p=l.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");n[l]={regx:RegExp(`&${p};`,"g"),val:u},i++}}else if(s&&Ge(t,"!ELEMENT",r)){r+=8;let{index:l}=this.readElementExp(t,r+1);r=l}else if(s&&Ge(t,"!ATTLIST",r))r+=8;else if(s&&Ge(t,"!NOTATION",r)){r+=9;let{index:l}=this.readNotationExp(t,r+1,this.suppressValidationErr);r=l}else if(Ge(t,"!--",r))a=!0;else throw new Error("Invalid DOCTYPE");o++,c=""}else if(t[r]===">"){if(a?t[r-1]==="-"&&t[r-2]==="-"&&(a=!1,o--):o--,o===0)break}else t[r]==="["?s=!0:c+=t[r];if(o!==0)throw new Error("Unclosed DOCTYPE")}else throw new Error("Invalid Tag instead of DOCTYPE");return{entities:n,i:r}}readEntityExp(t,r){r=pe(t,r);let n="";for(;r<t.length&&!/\s/.test(t[r])&&t[r]!=='"'&&t[r]!=="'";)n+=t[r],r++;if(ct(n),r=pe(t,r),!this.suppressValidationErr){if(t.substring(r,r+6).toUpperCase()==="SYSTEM")throw new Error("External entities are not supported");if(t[r]==="%")throw new Error("Parameter entities are not supported")}let i="";if([r,i]=this.readIdentifierVal(t,r,"entity"),this.options.enabled!==!1&&this.options.maxEntitySize!=null&&i.length>this.options.maxEntitySize)throw new Error(`Entity "${n}" size (${i.length}) exceeds maximum allowed size (${this.options.maxEntitySize})`);return r--,[n,i,r]}readNotationExp(t,r){r=pe(t,r);let n="";for(;r<t.length&&!/\s/.test(t[r]);)n+=t[r],r++;!this.suppressValidationErr&&ct(n),r=pe(t,r);let i=t.substring(r,r+6).toUpperCase();if(!this.suppressValidationErr&&i!=="SYSTEM"&&i!=="PUBLIC")throw new Error(`Expected SYSTEM or PUBLIC, found "${i}"`);r+=i.length,r=pe(t,r);let o=null,s=null;if(i==="PUBLIC")[r,o]=this.readIdentifierVal(t,r,"publicIdentifier"),r=pe(t,r),(t[r]==='"'||t[r]==="'")&&([r,s]=this.readIdentifierVal(t,r,"systemIdentifier"));else if(i==="SYSTEM"&&([r,s]=this.readIdentifierVal(t,r,"systemIdentifier"),!this.suppressValidationErr&&!s))throw new Error("Missing mandatory system identifier for SYSTEM notation");return{notationName:n,publicIdentifier:o,systemIdentifier:s,index:--r}}readIdentifierVal(t,r,n){let i="",o=t[r];if(o!=='"'&&o!=="'")throw new Error(`Expected quoted string, found "${o}"`);for(r++;r<t.length&&t[r]!==o;)i+=t[r],r++;if(t[r]!==o)throw new Error(`Unterminated ${n} value`);return r++,[r,i]}readElementExp(t,r){r=pe(t,r);let n="";for(;r<t.length&&!/\s/.test(t[r]);)n+=t[r],r++;if(!this.suppressValidationErr&&!bn.isName(n))throw new Error(`Invalid element name: "${n}"`);r=pe(t,r);let i="";if(t[r]==="E"&&Ge(t,"MPTY",r))r+=4;else if(t[r]==="A"&&Ge(t,"NY",r))r+=2;else if(t[r]==="("){for(r++;r<t.length&&t[r]!==")";)i+=t[r],r++;if(t[r]!==")")throw new Error("Unterminated content model")}else if(!this.suppressValidationErr)throw new Error(`Invalid Element Expression, found "${t[r]}"`);return{elementName:n,contentModel:i.trim(),index:r}}readAttlistExp(t,r){r=pe(t,r);let n="";for(;r<t.length&&!/\s/.test(t[r]);)n+=t[r],r++;ct(n),r=pe(t,r);let i="";for(;r<t.length&&!/\s/.test(t[r]);)i+=t[r],r++;if(!ct(i))throw new Error(`Invalid attribute name: "${i}"`);r=pe(t,r);let o="";if(t.substring(r,r+8).toUpperCase()==="NOTATION"){if(o="NOTATION",r+=8,r=pe(t,r),t[r]!=="(")throw new Error(`Expected '(', found "${t[r]}"`);r++;let a=[];for(;r<t.length&&t[r]!==")";){let c="";for(;r<t.length&&t[r]!=="|"&&t[r]!==")";)c+=t[r],r++;if(c=c.trim(),!ct(c))throw new Error(`Invalid notation name: "${c}"`);a.push(c),t[r]==="|"&&(r++,r=pe(t,r))}if(t[r]!==")")throw new Error("Unterminated list of notations");r++,o+=" ("+a.join("|")+")"}else{for(;r<t.length&&!/\s/.test(t[r]);)o+=t[r],r++;let a=["CDATA","ID","IDREF","IDREFS","ENTITY","ENTITIES","NMTOKEN","NMTOKENS"];if(!this.suppressValidationErr&&!a.includes(o.toUpperCase()))throw new Error(`Invalid attribute type: "${o}"`)}r=pe(t,r);let s="";return t.substring(r,r+8).toUpperCase()==="#REQUIRED"?(s="#REQUIRED",r+=8):t.substring(r,r+7).toUpperCase()==="#IMPLIED"?(s="#IMPLIED",r+=7):[r,s]=this.readIdentifierVal(t,r,"ATTLIST"),{elementName:n,attributeName:i,attributeType:o,defaultValue:s,index:r}}},pe=(e,t)=>{for(;t<e.length&&/\s/.test(e[t]);)t++;return t};function Ge(e,t,r){for(let n=0;n<t.length;n++)if(t[n]!==e[r+n+1])return!1;return!0}function ct(e){if(bn.isName(e))return e;throw new Error(`Invalid entity name ${e}`)}Cn.exports=ar});var Nn=fe((ip,kn)=>{var Ds=/^[-+]?0x[a-fA-F0-9]+$/,Vs=/^([\-\+])?(0*)([0-9]*(\.[0-9]*)?)$/,Us={hex:!0,leadingZeros:!0,decimalPoint:".",eNotation:!0};function _s(e,t={}){if(t=Object.assign({},Us,t),!e||typeof e!="string")return e;let r=e.trim();if(t.skipLike!==void 0&&t.skipLike.test(r))return e;if(e==="0")return 0;if(t.hex&&Ds.test(r))return Gs(r,16);if(r.search(/[eE]/)!==-1){let n=r.match(/^([-\+])?(0*)([0-9]*(\.[0-9]*)?[eE][-\+]?[0-9]+)$/);if(n){if(t.leadingZeros)r=(n[1]||"")+n[3];else if(!(n[2]==="0"&&n[3][0]==="."))return e;return t.eNotation?Number(r):e}else return e}else{let n=Vs.exec(r);if(n){let i=n[1],o=n[2],s=Bs(n[3]);if(!t.leadingZeros&&o.length>0&&i&&r[2]!==".")return e;if(!t.leadingZeros&&o.length>0&&!i&&r[1]!==".")return e;if(t.leadingZeros&&o===e)return 0;{let a=Number(r),c=""+a;return c.search(/[eE]/)!==-1?t.eNotation?a:e:r.indexOf(".")!==-1?c==="0"&&s===""||c===s||i&&c==="-"+s?a:e:o?s===c||i+s===c?a:e:r===c||r===i+c?a:e}}else return e}}function Bs(e){return e&&e.indexOf(".")!==-1&&(e=e.replace(/0+$/,""),e==="."?e="0":e[0]==="."?e="0"+e:e[e.length-1]==="."&&(e=e.substr(0,e.length-1))),e}function Gs(e,t){if(parseInt)return parseInt(e,t);if(Number.parseInt)return Number.parseInt(e,t);if(window&&window.parseInt)return window.parseInt(e,t);throw new Error("parseInt, Number.parseInt, window.parseInt are not supported")}kn.exports=_s});var cr=fe((op,$n)=>{function Ws(e){return typeof e=="function"?e:Array.isArray(e)?t=>{for(let r of e)if(typeof r=="string"&&t===r||r instanceof RegExp&&r.test(t))return!0}:()=>!1}$n.exports=Ws});var En=fe((sp,Tn)=>{"use strict";var Ct=st(),Ze=Pn(),Hs=xn(),Ks=Nn(),zs=cr(),lr=class{constructor(t){if(this.options=t,this.currentNode=null,this.tagsNodeStack=[],this.docTypeEntities={},this.lastEntities={apos:{regex:/&(apos|#39|#x27);/g,val:"'"},gt:{regex:/&(gt|#62|#x3E);/g,val:">"},lt:{regex:/&(lt|#60|#x3C);/g,val:"<"},quot:{regex:/&(quot|#34|#x22);/g,val:'"'}},this.ampEntity={regex:/&(amp|#38|#x26);/g,val:"&"},this.htmlEntities={space:{regex:/&(nbsp|#160);/g,val:" "},cent:{regex:/&(cent|#162);/g,val:"\xA2"},pound:{regex:/&(pound|#163);/g,val:"\xA3"},yen:{regex:/&(yen|#165);/g,val:"\xA5"},euro:{regex:/&(euro|#8364);/g,val:"\u20AC"},copyright:{regex:/&(copy|#169);/g,val:"\xA9"},reg:{regex:/&(reg|#174);/g,val:"\xAE"},inr:{regex:/&(inr|#8377);/g,val:"\u20B9"},num_dec:{regex:/&#([0-9]{1,7});/g,val:(r,n)=>An(n,10,"&#")},num_hex:{regex:/&#x([0-9a-fA-F]{1,6});/g,val:(r,n)=>An(n,16,"&#x")}},this.addExternalEntities=Xs,this.parseXml=Qs,this.parseTextData=qs,this.resolveNameSpace=Zs,this.buildAttributesMap=Js,this.isItStopNode=na,this.replaceEntitiesValue=ta,this.readStopNodeData=oa,this.saveTextToParentTag=ra,this.addChild=ea,this.ignoreAttributesFn=zs(this.options.ignoreAttributes),this.entityExpansionCount=0,this.currentExpandedLength=0,this.options.stopNodes&&this.options.stopNodes.length>0){this.stopNodesExact=new Set,this.stopNodesWildcard=new Set;for(let r=0;r<this.options.stopNodes.length;r++){let n=this.options.stopNodes[r];typeof n=="string"&&(n.startsWith("*.")?this.stopNodesWildcard.add(n.substring(2)):this.stopNodesExact.add(n))}}}};function Xs(e){let t=Object.keys(e);for(let r=0;r<t.length;r++){let n=t[r],i=n.replace(/[.\-+*:]/g,"\\.");this.lastEntities[n]={regex:new RegExp("&"+i+";","g"),val:e[n]}}}function qs(e,t,r,n,i,o,s){if(e!==void 0&&(this.options.trimValues&&!n&&(e=e.trim()),e.length>0)){s||(e=this.replaceEntitiesValue(e,t,r));let a=this.options.tagValueProcessor(t,e,r,i,o);return a==null?e:typeof a!=typeof e||a!==e?a:this.options.trimValues?dr(e,this.options.parseTagValue,this.options.numberParseOptions):e.trim()===e?dr(e,this.options.parseTagValue,this.options.numberParseOptions):e}}function Zs(e){if(this.options.removeNSPrefix){let t=e.split(":"),r=e.charAt(0)==="/"?"/":"";if(t[0]==="xmlns")return"";t.length===2&&(e=r+t[1])}return e}var Ys=new RegExp(`([^\\s=]+)\\s*(=\\s*(['"])([\\s\\S]*?)\\3)?`,"gm");function Js(e,t,r){if(this.options.ignoreAttributes!==!0&&typeof e=="string"){let n=Ct.getAllMatches(e,Ys),i=n.length,o={};for(let s=0;s<i;s++){let a=this.resolveNameSpace(n[s][1]);if(this.ignoreAttributesFn(a,t))continue;let c=n[s][4],l=this.options.attributeNamePrefix+a;if(a.length)if(this.options.transformAttributeName&&(l=this.options.transformAttributeName(l)),l=sa(l,this.options),c!==void 0){this.options.trimValues&&(c=c.trim()),c=this.replaceEntitiesValue(c,r,t);let u=this.options.attributeValueProcessor(a,c,t);u==null?o[l]=c:typeof u!=typeof c||u!==c?o[l]=u:o[l]=dr(c,this.options.parseAttributeValue,this.options.numberParseOptions)}else this.options.allowBooleanAttributes&&(o[l]=!0)}if(!Object.keys(o).length)return;if(this.options.attributesGroupName){let s={};return s[this.options.attributesGroupName]=o,s}return o}}var Qs=function(e){e=e.replace(/\r\n?/g,`
`);let t=new Ze("!xml"),r=t,n="",i="";this.entityExpansionCount=0,this.currentExpandedLength=0;let o=new Hs(this.options.processEntities);for(let s=0;s<e.length;s++)if(e[s]==="<")if(e[s+1]==="/"){let c=We(e,">",s,"Closing Tag is not closed."),l=e.substring(s+2,c).trim();if(this.options.removeNSPrefix){let d=l.indexOf(":");d!==-1&&(l=l.substr(d+1))}this.options.transformTagName&&(l=this.options.transformTagName(l)),r&&(n=this.saveTextToParentTag(n,r,i));let u=i.substring(i.lastIndexOf(".")+1);if(l&&this.options.unpairedTags.indexOf(l)!==-1)throw new Error(`Unpaired tag can not be used as closing tag: </${l}>`);let p=0;u&&this.options.unpairedTags.indexOf(u)!==-1?(p=i.lastIndexOf(".",i.lastIndexOf(".")-1),this.tagsNodeStack.pop()):p=i.lastIndexOf("."),i=i.substring(0,p),r=this.tagsNodeStack.pop(),n="",s=c}else if(e[s+1]==="?"){let c=pr(e,s,!1,"?>");if(!c)throw new Error("Pi Tag is not closed.");if(n=this.saveTextToParentTag(n,r,i),!(this.options.ignoreDeclaration&&c.tagName==="?xml"||this.options.ignorePiTags)){let l=new Ze(c.tagName);l.add(this.options.textNodeName,""),c.tagName!==c.tagExp&&c.attrExpPresent&&(l[":@"]=this.buildAttributesMap(c.tagExp,i,c.tagName)),this.addChild(r,l,i,s)}s=c.closeIndex+1}else if(e.substr(s+1,3)==="!--"){let c=We(e,"-->",s+4,"Comment is not closed.");if(this.options.commentPropName){let l=e.substring(s+4,c-2);n=this.saveTextToParentTag(n,r,i),r.add(this.options.commentPropName,[{[this.options.textNodeName]:l}])}s=c}else if(e.substr(s+1,2)==="!D"){let c=o.readDocType(e,s);this.docTypeEntities=c.entities,s=c.i}else if(e.substr(s+1,2)==="!["){let c=We(e,"]]>",s,"CDATA is not closed.")-2,l=e.substring(s+9,c);n=this.saveTextToParentTag(n,r,i);let u=this.parseTextData(l,r.tagname,i,!0,!1,!0,!0);u==null&&(u=""),this.options.cdataPropName?r.add(this.options.cdataPropName,[{[this.options.textNodeName]:l}]):r.add(this.options.textNodeName,u),s=c+2}else{let c=pr(e,s,this.options.removeNSPrefix),l=c.tagName,u=c.rawTagName,p=c.tagExp,d=c.attrExpPresent,f=c.closeIndex;if(this.options.transformTagName){let h=this.options.transformTagName(l);p===l&&(p=h),l=h}if(this.options.strictReservedNames&&(l===this.options.commentPropName||l===this.options.cdataPropName||l===this.options.textNodeName||l===this.options.attributesGroupName))throw new Error(`Invalid tag name: ${l}`);r&&n&&r.tagname!=="!xml"&&(n=this.saveTextToParentTag(n,r,i,!1));let m=r;m&&this.options.unpairedTags.indexOf(m.tagname)!==-1&&(r=this.tagsNodeStack.pop(),i=i.substring(0,i.lastIndexOf("."))),l!==t.tagname&&(i+=i?"."+l:l);let v=s;if(this.isItStopNode(this.stopNodesExact,this.stopNodesWildcard,i,l)){let h="";if(p.length>0&&p.lastIndexOf("/")===p.length-1)l[l.length-1]==="/"?(l=l.substr(0,l.length-1),i=i.substr(0,i.length-1),p=l):p=p.substr(0,p.length-1),s=c.closeIndex;else if(this.options.unpairedTags.indexOf(l)!==-1)s=c.closeIndex;else{let g=this.readStopNodeData(e,u,f+1);if(!g)throw new Error(`Unexpected end of ${u}`);s=g.i,h=g.tagContent}let P=new Ze(l);l!==p&&d&&(P[":@"]=this.buildAttributesMap(p,i,l)),h&&(h=this.parseTextData(h,l,i,!0,d,!0,!0)),i=i.substr(0,i.lastIndexOf(".")),P.add(this.options.textNodeName,h),this.addChild(r,P,i,v)}else{if(p.length>0&&p.lastIndexOf("/")===p.length-1){if(l[l.length-1]==="/"?(l=l.substr(0,l.length-1),i=i.substr(0,i.length-1),p=l):p=p.substr(0,p.length-1),this.options.transformTagName){let P=this.options.transformTagName(l);p===l&&(p=P),l=P}let h=new Ze(l);l!==p&&d&&(h[":@"]=this.buildAttributesMap(p,i,l)),this.addChild(r,h,i,v),i=i.substr(0,i.lastIndexOf("."))}else if(this.options.unpairedTags.indexOf(l)!==-1){let h=new Ze(l);l!==p&&d&&(h[":@"]=this.buildAttributesMap(p,i)),this.addChild(r,h,i,v),i=i.substr(0,i.lastIndexOf(".")),s=c.closeIndex;continue}else{let h=new Ze(l);if(this.tagsNodeStack.length>this.options.maxNestedTags)throw new Error("Maximum nested tags exceeded");this.tagsNodeStack.push(r),l!==p&&d&&(h[":@"]=this.buildAttributesMap(p,i,l)),this.addChild(r,h,i),r=h}n="",s=f}}else n+=e[s];return t.child};function ea(e,t,r,n){this.options.captureMetaData||(n=void 0);let i=this.options.updateTag(t.tagname,r,t[":@"]);i===!1||(typeof i=="string"&&(t.tagname=i),e.addChild(t,n))}var ta=function(e,t,r){if(e.indexOf("&")===-1)return e;let n=this.options.processEntities;if(!n.enabled||n.allowedTags&&!n.allowedTags.includes(t)||n.tagFilter&&!n.tagFilter(t,r))return e;for(let i in this.docTypeEntities){let o=this.docTypeEntities[i],s=e.match(o.regx);if(s){if(this.entityExpansionCount+=s.length,n.maxTotalExpansions&&this.entityExpansionCount>n.maxTotalExpansions)throw new Error(`Entity expansion limit exceeded: ${this.entityExpansionCount} > ${n.maxTotalExpansions}`);let a=e.length;if(e=e.replace(o.regx,o.val),n.maxExpandedLength&&(this.currentExpandedLength+=e.length-a,this.currentExpandedLength>n.maxExpandedLength))throw new Error(`Total expanded content size exceeded: ${this.currentExpandedLength} > ${n.maxExpandedLength}`)}}if(e.indexOf("&")===-1)return e;for(let i of Object.keys(this.lastEntities)){let o=this.lastEntities[i],s=e.match(o.regex);if(s&&(this.entityExpansionCount+=s.length,n.maxTotalExpansions&&this.entityExpansionCount>n.maxTotalExpansions))throw new Error(`Entity expansion limit exceeded: ${this.entityExpansionCount} > ${n.maxTotalExpansions}`);e=e.replace(o.regex,o.val)}if(e.indexOf("&")===-1)return e;if(this.options.htmlEntities)for(let i of Object.keys(this.htmlEntities)){let o=this.htmlEntities[i],s=e.match(o.regex);if(s&&(this.entityExpansionCount+=s.length,n.maxTotalExpansions&&this.entityExpansionCount>n.maxTotalExpansions))throw new Error(`Entity expansion limit exceeded: ${this.entityExpansionCount} > ${n.maxTotalExpansions}`);e=e.replace(o.regex,o.val)}return e=e.replace(this.ampEntity.regex,this.ampEntity.val),e};function ra(e,t,r,n){return e&&(n===void 0&&(n=t.child.length===0),e=this.parseTextData(e,t.tagname,r,!1,t[":@"]?Object.keys(t[":@"]).length!==0:!1,n),e!==void 0&&e!==""&&t.add(this.options.textNodeName,e),e=""),e}function na(e,t,r,n){return!!(t&&t.has(n)||e&&e.has(r))}function ia(e,t,r=">"){let n,i="";for(let o=t;o<e.length;o++){let s=e[o];if(n)s===n&&(n="");else if(s==='"'||s==="'")n=s;else if(s===r[0])if(r[1]){if(e[o+1]===r[1])return{data:i,index:o}}else return{data:i,index:o};else s==="	"&&(s=" ");i+=s}}function We(e,t,r,n){let i=e.indexOf(t,r);if(i===-1)throw new Error(n);return i+t.length-1}function pr(e,t,r,n=">"){let i=ia(e,t+1,n);if(!i)return;let o=i.data,s=i.index,a=o.search(/\s/),c=o,l=!0;a!==-1&&(c=o.substring(0,a),o=o.substring(a+1).trimStart());let u=c;if(r){let p=c.indexOf(":");p!==-1&&(c=c.substr(p+1),l=c!==i.data.substr(p+1))}return{tagName:c,tagExp:o,closeIndex:s,attrExpPresent:l,rawTagName:u}}function oa(e,t,r){let n=r,i=1;for(;r<e.length;r++)if(e[r]==="<")if(e[r+1]==="/"){let o=We(e,">",r,`${t} is not closed`);if(e.substring(r+2,o).trim()===t&&(i--,i===0))return{tagContent:e.substring(n,r),i:o};r=o}else if(e[r+1]==="?")r=We(e,"?>",r+1,"StopNode is not closed.");else if(e.substr(r+1,3)==="!--")r=We(e,"-->",r+3,"StopNode is not closed.");else if(e.substr(r+1,2)==="![")r=We(e,"]]>",r,"StopNode is not closed.")-2;else{let o=pr(e,r,">");o&&((o&&o.tagName)===t&&o.tagExp[o.tagExp.length-1]!=="/"&&i++,r=o.closeIndex)}}function dr(e,t,r){if(t&&typeof e=="string"){let n=e.trim();return n==="true"?!0:n==="false"?!1:Ks(e,r)}else return Ct.isExist(e)?e:""}function An(e,t,r){let n=Number.parseInt(e,t);return n>=0&&n<=1114111?String.fromCodePoint(n):r+e+";"}function sa(e,t){if(Ct.criticalProperties.includes(e))throw new Error(`[SECURITY] Invalid name: "${e}" is a reserved JavaScript keyword that could cause prototype pollution`);return Ct.DANGEROUS_PROPERTY_NAMES.includes(e)?t.onDangerousProperty(e):e}Tn.exports=lr});var Mn=fe(Fn=>{"use strict";function aa(e,t){return Rn(e,t)}function Rn(e,t,r){let n,i={};for(let o=0;o<e.length;o++){let s=e[o],a=ca(s),c="";if(r===void 0?c=a:c=r+"."+a,a===t.textNodeName)n===void 0?n=s[a]:n+=""+s[a];else{if(a===void 0)continue;if(s[a]){let l=Rn(s[a],t,c),u=pa(l,t);s[":@"]?la(l,s[":@"],c,t):Object.keys(l).length===1&&l[t.textNodeName]!==void 0&&!t.alwaysCreateTextNode?l=l[t.textNodeName]:Object.keys(l).length===0&&(t.alwaysCreateTextNode?l[t.textNodeName]="":l=""),i[a]!==void 0&&i.hasOwnProperty(a)?(Array.isArray(i[a])||(i[a]=[i[a]]),i[a].push(l)):t.isArray(a,c,u)?i[a]=[l]:i[a]=l}}}return typeof n=="string"?n.length>0&&(i[t.textNodeName]=n):n!==void 0&&(i[t.textNodeName]=n),i}function ca(e){let t=Object.keys(e);for(let r=0;r<t.length;r++){let n=t[r];if(n!==":@")return n}}function la(e,t,r,n){if(t){let i=Object.keys(t),o=i.length;for(let s=0;s<o;s++){let a=i[s];n.isArray(a,r+"."+a,!0,!0)?e[a]=[t[a]]:e[a]=t[a]}}}function pa(e,t){let{textNodeName:r}=t,n=Object.keys(e).length;return!!(n===0||n===1&&(e[r]||typeof e[r]=="boolean"||e[r]===0))}Fn.prettify=aa});var jn=fe((cp,In)=>{var{buildOptions:da}=wn(),ua=En(),{prettify:fa}=Mn(),ma=ir(),ur=class{constructor(t){this.externalEntities={},this.options=da(t)}parse(t,r){if(typeof t!="string")if(t.toString)t=t.toString();else throw new Error("XML data is accepted in String or Bytes[] form.");if(r){r===!0&&(r={});let o=ma.validate(t,r);if(o!==!0)throw Error(`${o.err.msg}:${o.err.line}:${o.err.col}`)}let n=new ua(this.options);n.addExternalEntities(this.externalEntities);let i=n.parseXml(t);return this.options.preserveOrder||i===void 0?i:fa(i,this.options)}addEntity(t,r){if(r.indexOf("&")!==-1)throw new Error("Entity value can't have '&'");if(t.indexOf("&")!==-1||t.indexOf(";")!==-1)throw new Error("An entity must be set without '&' and ';'. Eg. use '#xD' for '&#xD;'");if(r==="&")throw new Error("An entity with value '&' is not permitted");this.externalEntities[t]=r}};In.exports=ur});var Vn=fe((lp,Dn)=>{var ga=`
`;function ha(e,t){let r="";return t.format&&t.indentBy.length>0&&(r=ga),On(e,t,"",r)}function On(e,t,r,n){let i="",o=!1;if(!Array.isArray(e)){if(e!=null){let s=e.toString();return s=fr(s,t),s}return""}for(let s=0;s<e.length;s++){let a=e[s],c=va(a);if(c===void 0)continue;let l="";if(r.length===0?l=c:l=`${r}.${c}`,c===t.textNodeName){let m=a[c];ya(l,t)||(m=t.tagValueProcessor(c,m),m=fr(m,t)),o&&(i+=n),i+=m,o=!1;continue}else if(c===t.cdataPropName){o&&(i+=n),i+=`<![CDATA[${a[c][0][t.textNodeName]}]]>`,o=!1;continue}else if(c===t.commentPropName){i+=n+`<!--${a[c][0][t.textNodeName]}-->`,o=!0;continue}else if(c[0]==="?"){let m=Ln(a[":@"],t),v=c==="?xml"?"":n,h=a[c][0][t.textNodeName];h=h.length!==0?" "+h:"",i+=v+`<${c}${h}${m}?>`,o=!0;continue}let u=n;u!==""&&(u+=t.indentBy);let p=Ln(a[":@"],t),d=n+`<${c}${p}`,f=On(a[c],t,l,u);t.unpairedTags.indexOf(c)!==-1?t.suppressUnpairedNode?i+=d+">":i+=d+"/>":(!f||f.length===0)&&t.suppressEmptyNode?i+=d+"/>":f&&f.endsWith(">")?i+=d+`>${f}${n}</${c}>`:(i+=d+">",f&&n!==""&&(f.includes("/>")||f.includes("</"))?i+=n+t.indentBy+f+n:i+=f,i+=`</${c}>`),o=!0}return i}function va(e){let t=Object.keys(e);for(let r=0;r<t.length;r++){let n=t[r];if(Object.prototype.hasOwnProperty.call(e,n)&&n!==":@")return n}}function Ln(e,t){let r="";if(e&&!t.ignoreAttributes)for(let n in e){if(!Object.prototype.hasOwnProperty.call(e,n))continue;let i=t.attributeValueProcessor(n,e[n]);i=fr(i,t),i===!0&&t.suppressBooleanAttributes?r+=` ${n.substr(t.attributeNamePrefix.length)}`:r+=` ${n.substr(t.attributeNamePrefix.length)}="${i}"`}return r}function ya(e,t){e=e.substr(0,e.length-t.textNodeName.length-1);let r=e.substr(e.lastIndexOf(".")+1);for(let n in t.stopNodes)if(t.stopNodes[n]===e||t.stopNodes[n]==="*."+r)return!0;return!1}function fr(e,t){if(e&&e.length>0&&t.processEntities)for(let r=0;r<t.entities.length;r++){let n=t.entities[r];e=e.replace(n.regex,n.val)}return e}Dn.exports=ha});var _n=fe((pp,Un)=>{"use strict";var wa=Vn(),Sa=cr(),Pa={attributeNamePrefix:"@_",attributesGroupName:!1,textNodeName:"#text",ignoreAttributes:!0,cdataPropName:!1,format:!1,indentBy:"  ",suppressEmptyNode:!1,suppressUnpairedNode:!0,suppressBooleanAttributes:!0,tagValueProcessor:function(e,t){return t},attributeValueProcessor:function(e,t){return t},preserveOrder:!1,commentPropName:!1,unpairedTags:[],entities:[{regex:new RegExp("&","g"),val:"&amp;"},{regex:new RegExp(">","g"),val:"&gt;"},{regex:new RegExp("<","g"),val:"&lt;"},{regex:new RegExp("'","g"),val:"&apos;"},{regex:new RegExp('"',"g"),val:"&quot;"}],processEntities:!0,stopNodes:[],oneListGroup:!1};function De(e){this.options=Object.assign({},Pa,e),this.options.ignoreAttributes===!0||this.options.attributesGroupName?this.isAttribute=function(){return!1}:(this.ignoreAttributesFn=Sa(this.options.ignoreAttributes),this.attrPrefixLen=this.options.attributeNamePrefix.length,this.isAttribute=xa),this.processTextOrObjNode=ba,this.options.format?(this.indentate=Ca,this.tagEndChar=`>
`,this.newLine=`
`):(this.indentate=function(){return""},this.tagEndChar=">",this.newLine="")}De.prototype.build=function(e){return this.options.preserveOrder?wa(e,this.options):(Array.isArray(e)&&this.options.arrayNodeName&&this.options.arrayNodeName.length>1&&(e={[this.options.arrayNodeName]:e}),this.j2x(e,0,[]).val)};De.prototype.j2x=function(e,t,r){let n="",i="",o=r.join(".");for(let s in e)if(Object.prototype.hasOwnProperty.call(e,s))if(typeof e[s]>"u")this.isAttribute(s)&&(i+="");else if(e[s]===null)this.isAttribute(s)||s===this.options.cdataPropName?i+="":s[0]==="?"?i+=this.indentate(t)+"<"+s+"?"+this.tagEndChar:i+=this.indentate(t)+"<"+s+"/"+this.tagEndChar;else if(e[s]instanceof Date)i+=this.buildTextValNode(e[s],s,"",t);else if(typeof e[s]!="object"){let a=this.isAttribute(s);if(a&&!this.ignoreAttributesFn(a,o))n+=this.buildAttrPairStr(a,""+e[s]);else if(!a)if(s===this.options.textNodeName){let c=this.options.tagValueProcessor(s,""+e[s]);i+=this.replaceEntitiesValue(c)}else i+=this.buildTextValNode(e[s],s,"",t)}else if(Array.isArray(e[s])){let a=e[s].length,c="",l="";for(let u=0;u<a;u++){let p=e[s][u];if(!(typeof p>"u"))if(p===null)s[0]==="?"?i+=this.indentate(t)+"<"+s+"?"+this.tagEndChar:i+=this.indentate(t)+"<"+s+"/"+this.tagEndChar;else if(typeof p=="object")if(this.options.oneListGroup){let d=this.j2x(p,t+1,r.concat(s));c+=d.val,this.options.attributesGroupName&&p.hasOwnProperty(this.options.attributesGroupName)&&(l+=d.attrStr)}else c+=this.processTextOrObjNode(p,s,t,r);else if(this.options.oneListGroup){let d=this.options.tagValueProcessor(s,p);d=this.replaceEntitiesValue(d),c+=d}else c+=this.buildTextValNode(p,s,"",t)}this.options.oneListGroup&&(c=this.buildObjectNode(c,s,l,t)),i+=c}else if(this.options.attributesGroupName&&s===this.options.attributesGroupName){let a=Object.keys(e[s]),c=a.length;for(let l=0;l<c;l++)n+=this.buildAttrPairStr(a[l],""+e[s][a[l]])}else i+=this.processTextOrObjNode(e[s],s,t,r);return{attrStr:n,val:i}};De.prototype.buildAttrPairStr=function(e,t){return t=this.options.attributeValueProcessor(e,""+t),t=this.replaceEntitiesValue(t),this.options.suppressBooleanAttributes&&t==="true"?" "+e:" "+e+'="'+t+'"'};function ba(e,t,r,n){let i=this.j2x(e,r+1,n.concat(t));return e[this.options.textNodeName]!==void 0&&Object.keys(e).length===1?this.buildTextValNode(e[this.options.textNodeName],t,i.attrStr,r):this.buildObjectNode(i.val,t,i.attrStr,r)}De.prototype.buildObjectNode=function(e,t,r,n){if(e==="")return t[0]==="?"?this.indentate(n)+"<"+t+r+"?"+this.tagEndChar:this.indentate(n)+"<"+t+r+this.closeTag(t)+this.tagEndChar;{let i="</"+t+this.tagEndChar,o="";return t[0]==="?"&&(o="?",i=""),(r||r==="")&&e.indexOf("<")===-1?this.indentate(n)+"<"+t+r+o+">"+e+i:this.options.commentPropName!==!1&&t===this.options.commentPropName&&o.length===0?this.indentate(n)+`<!--${e}-->`+this.newLine:this.indentate(n)+"<"+t+r+o+this.tagEndChar+e+this.indentate(n)+i}};De.prototype.closeTag=function(e){let t="";return this.options.unpairedTags.indexOf(e)!==-1?this.options.suppressUnpairedNode||(t="/"):this.options.suppressEmptyNode?t="/":t=`></${e}`,t};De.prototype.buildTextValNode=function(e,t,r,n){if(this.options.cdataPropName!==!1&&t===this.options.cdataPropName)return this.indentate(n)+`<![CDATA[${e}]]>`+this.newLine;if(this.options.commentPropName!==!1&&t===this.options.commentPropName)return this.indentate(n)+`<!--${e}-->`+this.newLine;if(t[0]==="?")return this.indentate(n)+"<"+t+r+"?"+this.tagEndChar;{let i=this.options.tagValueProcessor(t,e);return i=this.replaceEntitiesValue(i),i===""?this.indentate(n)+"<"+t+r+this.closeTag(t)+this.tagEndChar:this.indentate(n)+"<"+t+r+">"+i+"</"+t+this.tagEndChar}};De.prototype.replaceEntitiesValue=function(e){if(e&&e.length>0&&this.options.processEntities)for(let t=0;t<this.options.entities.length;t++){let r=this.options.entities[t];e=e.replace(r.regex,r.val)}return e};function Ca(e){return this.options.indentBy.repeat(e)}function xa(e){return e.startsWith(this.options.attributeNamePrefix)&&e!==this.options.textNodeName?e.substr(this.attrPrefixLen):!1}Un.exports=De});var Gn=fe((dp,Bn)=>{"use strict";var ka=ir(),Na=jn(),$a=_n();Bn.exports={XMLParser:Na,XMLValidator:ka,XMLBuilder:$a}});function tc(e,t){if(e instanceof Error){let r=e.code,n=e.message||r||"unknown error";return new Error(`Request to ${t} failed: ${n}${r&&!e.message?.includes(r)?` (${r})`:""}`)}return new Error(`Request to ${t} failed: ${String(e)}`)}var Qa,ec,pi,de,ze=Ie(()=>{"use strict";Qa=y(require("http")),ec=y(require("https")),pi=require("url"),de=class{constructor(t){this.endpoint=t}apiVersion="6.0";async getClusterHealth(t=5e3){let r=await this.get("/$/GetClusterHealth",t);return{aggregatedHealthState:String(r?.AggregatedHealthState??"Unknown")}}async getNodes(t=5e3){return((await this.get("/Nodes",t))?.Items??[]).map(i=>({name:String(i?.Name??""),status:String(i?.NodeStatus??""),healthState:String(i?.HealthState??""),nodeType:String(i?.Type??"")}))}async getDeployedApplications(t=5e3){return((await this.get("/Applications/",t))?.Items??[]).map(i=>({name:String(i?.Name??"").replace(/^fabric:\//,""),typeName:String(i?.TypeName??""),typeVersion:String(i?.TypeVersion??""),status:String(i?.Status??"")}))}async getApplicationNodes(t,r=5e3){let n=encodeURIComponent(t.replace(/^fabric:\//,"")),o=(await this.get(`/Applications/${n}/$/GetServices`,r))?.Items??[],s=new Set;for(let a of o){let c=encodeURIComponent(String(a?.Id??""));if(!c)continue;let l=await this.get(`/Services/${c}/$/GetPartitions`,r).catch(()=>({Items:[]}));for(let u of l?.Items??[]){let p=encodeURIComponent(String(u?.PartitionInformation?.Id??""));if(!p)continue;let d=await this.get(`/Partitions/${p}/$/GetReplicas`,r).catch(()=>({Items:[]}));for(let f of d?.Items??[])f?.NodeName&&s.add(String(f.NodeName))}}return Array.from(s)}async listServices(t,r=5e3){let n=encodeURIComponent(t.replace(/^fabric:\//,""));return((await this.get(`/Applications/${n}/$/GetServices`,r))?.Items??[]).map(s=>({id:encodeURIComponent(String(s?.Id??"")),manifestName:String(s?.ServiceManifestName??s?.TypeName??"")}))}async listReplicas(t,r=5e3){let n=await this.get(`/Services/${t}/$/GetPartitions`,r).catch(()=>({Items:[]})),i=[];for(let o of n?.Items??[]){let s=encodeURIComponent(String(o?.PartitionInformation?.Id??""));if(!s)continue;let a=await this.get(`/Partitions/${s}/$/GetReplicas`,r).catch(()=>({Items:[]}));for(let c of a?.Items??[])i.push({replicaStatus:String(c?.ReplicaStatus??""),nodeName:String(c?.NodeName??"")})}return i}async getDeployedCodePackages(t,r,n=5e3){let i=t.replace(/^fabric:\//,""),o=[];for(let s of r){let a=`/Nodes/${encodeURIComponent(s)}/$/GetApplications/${encodeURIComponent(i)}/$/GetCodePackages`,c=await this.get(a,n).catch(()=>{}),l=Array.isArray(c)?c:Array.isArray(c?.Items)?c.Items:[];for(let u of l){let p=u?.MainEntryPoint?.ProcessId??u?.SetupEntryPoint?.ProcessId,d=Number(p);o.push({nodeName:s,serviceManifestName:String(u?.ServiceManifestName??""),codePackageName:String(u?.Name??""),codePackageVersion:String(u?.Version??""),status:String(u?.Status??u?.HostType??""),entryPointStatus:String(u?.MainEntryPoint?.Status??u?.MainEntryPoint?.EntryPointStatus??""),processId:Number.isFinite(d)&&d>0?d:void 0,hostType:String(u?.HostType??"")})}}return o}rawGet(t,r=5e3){return this.get(t,r)}get(t,r){let n=t.includes("?")?"&":"?",i=new pi.URL(`${this.endpoint}${t}${n}api-version=${this.apiVersion}`),o=i.protocol==="https:"?ec:Qa;return new Promise((s,a)=>{let c=o.request({method:"GET",hostname:i.hostname,port:i.port||(i.protocol==="https:"?443:80),path:`${i.pathname}${i.search}`,headers:{Accept:"application/json"},timeout:r},l=>{let u=[];l.on("data",p=>u.push(Buffer.from(p))),l.on("end",()=>{let p=Buffer.concat(u).toString("utf8");if(!l.statusCode||l.statusCode>=400){a(new Error(`HTTP ${l.statusCode} from ${i.href}: ${p}`));return}try{s(p?JSON.parse(p):void 0)}catch(d){a(d)}})});c.on("error",l=>a(tc(l,i.href))),c.on("timeout",()=>c.destroy(new Error(`Request to ${i.href} timed out after ${r}ms`))),c.end()})}}});var Hi={};bt(Hi,{TIER2_PROMPT_BUTTONS:()=>Gi,TIER2_PROMPT_SUPPRESS_KEY_PREFIX:()=>Bi,buildTier2PromptMessage:()=>Wi,resolveTier2PromptDecision:()=>_i,runTier2Prompt:()=>Er,tier2SuppressKey:()=>hc});function _i(e){switch(e){case"Use for this Publish":return"use-once";case"Always use (save setting)":return"use-persist";default:return"cancel"}}function hc(e,t=process.platform){let r=t==="win32"?e.toLowerCase():e;return`${Bi}${r}`}function Wi(e){let t=[...e],r=t.slice(0,3).map(s=>`$(${s})`),n=t.length-r.length,i=r.join(", ")+(n>0?` (+${n} more)`:"");return{message:`The .sfproj's package paths reference MSBuild properties that aren't declared in the project itself (${i}). These typically come from Directory.Build.props or imported .targets files.

Enable MSBuild property evaluation (serviceFabric.deploy.useMsbuildPropertyEvaluator) so this Publish can resolve them by spawning MSBuild?

Cancel to abort this Publish; you can also set serviceFabric.deploy.packagePath directly to the package folder.`,sampleText:i}}async function Er(e,t){if(e.isPromptSuppressedBySetting())return e.logger.info("Tier 2 prompt suppressed by serviceFabric.deploy.suppressMsbuildEvaluatorPrompt."),{useEvaluator:!1,cancelled:!1,outcome:"suppressed-setting"};e.logger.info(`Unresolved MSBuild properties in package-path candidates: ${[...t.unresolvedTokens].map(o=>`$(${o})`).join(", ")}.`);let{message:r}=Wi(t.unresolvedTokens),n=await e.showPrompt(r,Gi);switch(_i(n)){case"use-once":return e.logger.info("Tier 2 enabled for this Publish (user choice; setting not persisted)."),{useEvaluator:!0,cancelled:!1,outcome:"use-once"};case"use-persist":try{return await e.persistEvaluatorSetting(),e.logger.info("Tier 2 enabled and persisted to workspace settings."),{useEvaluator:!0,cancelled:!1,outcome:"use-persist"}}catch(o){return e.logger.warn(`Could not persist serviceFabric.deploy.useMsbuildPropertyEvaluator=true (${o instanceof Error?o.message:String(o)}). Tier 2 still enabled for this Publish.`),{useEvaluator:!0,cancelled:!1,outcome:"persist-failed"}}case"cancel":return e.logger.info("Publish cancelled by user \u2014 declined MSBuild property evaluator prompt."),{useEvaluator:!1,cancelled:!0,outcome:"cancelled"}}}var Bi,Gi,Rr=Ie(()=>{"use strict";Bi="serviceFabric.deploy.tier2PromptSuppressedFor:";Gi=["Use for this Publish","Always use (save setting)"]});function ht(e,t){return{type:t,name:`Attach: ${e.serviceManifestName}/${e.codePackageName} (pid ${e.processId})`,request:"attach",processId:e.processId??0,justMyCode:!0}}var Dt=Ie(()=>{"use strict"});function vc(e){return e.clusterKind!=="local"?{kind:"skip"}:e.oneShotPending?{kind:"attach"}:e.setting==="localOnly"?{kind:"attach"}:e.promptShownBefore?{kind:"skip"}:{kind:"prompt-then-decide"}}function yc(e,t){let r=e.filter(n=>typeof n.processId=="number"&&n.processId>0);return r.length<=t?{selected:[...r],droppedCount:0}:{selected:r.slice(0,t),droppedCount:r.length-t}}function wc(e){switch(e){case"attach-once-localOnly":return{settingUpdate:"localOnly",attachThisTime:!0};case"never-this-time":return{settingUpdate:void 0,attachThisTime:!1};case"dont-ask-again":return{settingUpdate:"never",attachThisTime:!1}}}function Pc(e){return`${Sc}${e}`}async function Fr(e,t,r,n){let i=Date.now(),o=Pc(t.applicationName),s=e.getMementoFlag(o);s&&await e.setMementoFlag(o,void 0);let a=e.getSetting(),c=e.getMementoFlag(Ki),l=vc({setting:a,clusterKind:t.clusterKind,oneShotPending:s,promptShownBefore:c});if(n.event("extension.debug.autoAttach.decision",{setting:a,clusterKind:t.clusterKind,oneShot:s,decision:l.kind==="prompt-then-decide"?"prompt":l.kind}),l.kind==="skip"){t.clusterKind!=="local"&&(r.debug(`Auto-attach skipped \u2014 active cluster is ${t.clusterKind}; remote-cluster auto-attach is deferred to a future release.`),n.event("extension.debug.autoAttach.result",{outcome:"skipped-remote",attachedCount:0,droppedCount:0,clusterKind:t.clusterKind,durationMs:Date.now()-i}));return}let u=l.kind==="attach";if(l.kind==="prompt-then-decide"){let S=await e.showFirstDeployPrompt();await e.setMementoFlag(Ki,!0);let z=wc(S??"never-this-time");if(z.settingUpdate)try{await e.updateSetting(z.settingUpdate)}catch(O){r.warn(`Auto-attach: failed to persist setting '${z.settingUpdate}': ${O instanceof Error?O.message:String(O)}`)}if(u=z.attachThisTime,!u)return}if(!u)return;if(!await e.ensureDebuggerAvailable()){r.warn("Auto-attach skipped \u2014 debugger pre-flight declined or failed."),n.event("extension.debug.autoAttach.result",{outcome:"preflight-declined",attachedCount:0,droppedCount:0,clusterKind:t.clusterKind,durationMs:Date.now()-i});return}if(!await bc(e,t.applicationName)){r.warn(`Auto-attach skipped \u2014 no service replica became Ready within ${Math.round(e.readyTimeoutMs/1e3)}s.`),n.event("extension.debug.autoAttach.result",{outcome:"ready-timeout",attachedCount:0,droppedCount:0,clusterKind:t.clusterKind,durationMs:Date.now()-i}),await e.showWarning(`Auto-attach skipped \u2014 no service replica became Ready within ${Math.round(e.readyTimeoutMs/1e3)}s.`,"Retry")==="Retry"&&await Fr(e,t,r,n);return}let f=[];try{f=await e.getNodeNames()}catch(S){r.warn(`Auto-attach: failed to list nodes for PID resolution: ${S instanceof Error?S.message:String(S)}`)}let m=[];try{m=await e.getDeployedCodePackages(t.applicationName,f)}catch(S){r.warn(`Auto-attach: failed to list deployed code packages: ${S instanceof Error?S.message:String(S)}`)}let{selected:v,droppedCount:h}=yc(m,e.maxSessions);if(v.length===0){e.showInfo("Auto-attach: no host processes were available to attach. Containers and Guest Executables do not expose a managed PID via the SF gateway."),n.event("extension.debug.autoAttach.result",{outcome:"no-eligible-pids",attachedCount:0,droppedCount:h,clusterKind:t.clusterKind,durationMs:Date.now()-i});return}let P=0;for(let S of v){let z=ht(S,"coreclr");r.info(`Auto-attach: starting coreclr debugger against PID ${S.processId} (${S.serviceManifestName}/${S.codePackageName} on ${S.nodeName}).`);try{await e.startDebugging(z)?P++:r.warn(`Auto-attach: vscode.debug.startDebugging returned false for PID ${S.processId} (${S.serviceManifestName}/${S.codePackageName}).`)}catch(O){r.error(`Auto-attach: vscode.debug.startDebugging threw for PID ${S.processId} (${S.serviceManifestName}/${S.codePackageName})`,O)}}let g=v.length,w=h>0?` (${h} additional host(s) skipped \u2014 raise serviceFabric.debug.autoAttachMaxSessions to include them.)`:"";if(P===g&&g===1){let S=v[0];e.showInfo(`Auto-attached debugger to ${S.serviceManifestName}/${S.codePackageName} (pid ${S.processId}).${w}`)}else P===g?e.showInfo(`Auto-attached debugger to ${P} service(s) of ${t.applicationName}.${w}`):await e.showWarning(`Auto-attached debugger to ${P} of ${g} service(s). See Service Fabric output channel for failures.${w}`,"Open Output Channel")==="Open Output Channel"&&e.showOutputChannel();let b=P===g?"success":P===0?"failed":"partial";n.event("extension.debug.autoAttach.result",{outcome:b,attachedCount:P,droppedCount:h,clusterKind:t.clusterKind,durationMs:Date.now()-i})}async function bc(e,t){let r=Date.now()+e.readyTimeoutMs;for(;Date.now()<r;){let n=[];try{n=await e.listServices(t)}catch{n=[]}if(n.length===0){await e.sleep(e.pollIntervalMs);continue}let i=!1;for(let o of n){let s=[];try{s=await e.listReplicas(o.id)}catch{s=[]}if(s.some(a=>a.replicaStatus==="Ready")){i=!0;break}}if(i)return!0;await e.sleep(e.pollIntervalMs)}return!1}var Ki,Sc,zi=Ie(()=>{"use strict";Dt();Ki="serviceFabric.debug.autoAttachPromptShown",Sc="serviceFabric.autoAttachNext:"});function Cc(e){return e==="coreclr"?{extensionId:"ms-dotnettools.csharp",extensionName:"C# (ms-dotnettools.csharp)"}:{extensionId:"ms-dotnettools.csharp",extensionName:"C# (ms-dotnettools.csharp)",platformRestricted:{allowedPlatform:"win32",reason:".NET Framework (clr) debugging is Windows-only."},additionalAdvice:"Native CLR debugging may also require the Visual Studio Remote Debugger components on the host running the service."}}function Xi(e,t){let r=Cc(e);return r.platformRestricted&&t.platform!==r.platformRestricted.allowedPlatform?{kind:"platform-blocked",reason:r.platformRestricted.reason}:t.isExtensionInstalled(r.extensionId)?{kind:"available"}:{kind:"extension-missing",requirement:r}}function qi(e){return e===Mr?"install":e===Ir?"marketplace":"cancel"}function Yi(e,t){let r=e==="coreclr"?".NET (coreclr)":".NET Framework (clr)";return`The ${t.extensionName} extension is required to attach the ${r} debugger.`}function Ji(e,t){return e==="clr"?`${t} Pick coreclr instead, or move to a Windows host.`:t}var Mr,Ir,Zi,Qi=Ie(()=>{"use strict";Mr="Install C# Extension",Ir="Open Marketplace",Zi="Cancel"});async function eo(e,t,r){let n=r?.connection??e.getActive();if(!n||!n.connected){M.window.showWarningMessage("Connect to a Service Fabric cluster before attaching a debugger.");return}let i=new de(n.endpoint),o=n.deployedApplications??await i.getDeployedApplications().catch(()=>[]);if(o.length===0){M.window.showWarningMessage("No deployed applications were found on the active cluster.");return}let s=r?.appName,a=s?o.find(P=>P.name===s.replace(/^fabric:\//,"")):void 0;if(a||(a=(await M.window.showQuickPick(o.map(g=>({label:g.name,description:`${g.typeName} v${g.typeVersion}`,detail:g.status,app:g})),{placeHolder:"Select the application that hosts the service to attach to"}))?.app),!a)return;let c=n.nodes?.map(P=>P.name)??[],l=c.length>0?c:(await i.getNodes()).map(P=>P.name);if(l.length===0){M.window.showWarningMessage("No cluster nodes were reported.");return}let u=a.name.startsWith("fabric:/")?a.name:`fabric:/${a.name}`,d=(await M.window.withProgress({location:M.ProgressLocation.Notification,title:`Locating processes for ${a.name}\u2026`},()=>i.getDeployedCodePackages(u,l))).filter(P=>P.processId);if(d.length===0){M.window.showWarningMessage(`No running code packages with a known PID were found for ${a.name}. Containers and Guest Executables may not expose a PID via the SF gateway.`);return}let f=await Ac(d);if(!f)return;let m=await Tc();if(!m||!await jr(m,t))return;let v=ht(f,m);t.info(`Attaching ${m} debugger to PID ${f.processId} (${f.serviceManifestName}/${f.codePackageName} on ${f.nodeName})`),await M.debug.startDebugging(void 0,v)||await M.window.showErrorMessage(`VS Code refused to start the ${m} debugger for PID ${f.processId}. Possible causes: the process exited, the C# extension did not activate, or another extension claimed the debug type. Check the Service Fabric output channel for details.`,"Open Output Channel")==="Open Output Channel"&&t.outputChannel.show(!0)}async function jr(e,t){if(M.workspace.getConfiguration("serviceFabric").get("debug.suppressInstallPrompt")===!0)return!0;let n=Xi(e,{platform:process.platform,isExtensionInstalled:l=>!!M.extensions.getExtension(l)});if(n.kind==="available")return!0;if(n.kind==="platform-blocked")return await M.window.showErrorMessage(Ji(e,n.reason)),!1;let i=n.requirement,o=Yi(e,i),s=await M.window.showErrorMessage(o,{modal:!0},Mr,Ir,Zi),a=qi(s);return a==="cancel"?!1:a==="marketplace"?(await M.commands.executeCommand("workbench.extensions.search",`@id:${i.extensionId}`),!1):(await Nc(i.extensionId,t),await $c(i.extensionId)?(i.additionalAdvice&&M.window.showInformationMessage(i.additionalAdvice),!0):(M.window.showErrorMessage(`Install of ${i.extensionId} did not complete. Open the Extensions view and install it manually, then re-run Attach Debugger to Deployed Service\u2026`),!1))}async function Nc(e,t){await M.window.withProgress({location:M.ProgressLocation.Notification,title:`Installing ${e}\u2026`,cancellable:!1},async()=>{try{await M.commands.executeCommand("workbench.extensions.installExtension",e),t.info(`Installed extension ${e}`)}catch(r){t.error(`Failed to install ${e}: ${r instanceof Error?r.message:String(r)}`)}})}async function $c(e){let t=Date.now()+kc;for(;Date.now()<t;){if(M.extensions.getExtension(e))return!0;await new Promise(r=>setTimeout(r,xc))}return!!M.extensions.getExtension(e)}function Ac(e){return M.window.showQuickPick(e.map(t=>({label:`$(debug-alt) ${t.serviceManifestName} / ${t.codePackageName}`,description:`pid ${t.processId} \u2022 ${t.nodeName}`,detail:`${t.hostType||"host"} \u2022 v${t.codePackageVersion} \u2022 ${t.entryPointStatus}`,pkg:t})),{placeHolder:"Select the code package replica to attach to"}).then(t=>t?.pkg)}function Tc(){return M.window.showQuickPick([{label:".NET (coreclr)",description:"Modern .NET / .NET Core. Requires C# extension.",value:"coreclr"},{label:".NET Framework (clr)",description:"Windows-only legacy CLR. Requires Visual Studio for Windows debugger or compatible.",value:"clr"}],{placeHolder:"Select the runtime to attach (Service Fabric services typically use coreclr)"}).then(e=>e?.value)}var M,xc,kc,Vt,Lr=Ie(()=>{"use strict";M=y(require("vscode"));ze();Dt();Qi();Dt();xc=200,kc=5e3;Vt=class{constructor(t){this.store=t}provideDebugConfigurations(){return[{type:"servicefabric",request:"attach",name:"Service Fabric: Attach to Deployed Service",runtime:"coreclr"}]}async resolveDebugConfiguration(t,r){if(r.type!=="servicefabric")return r;if(!this.store.getActive()?.connected){await M.window.showWarningMessage("No Service Fabric cluster is connected. Connect first?","Connect Local Cluster","Cancel")==="Connect Local Cluster"&&await M.commands.executeCommand("serviceFabric.cluster.connectLocal");return}await M.commands.executeCommand("serviceFabric.debug.attachToService")}}});var co={};bt(co,{maybeAutoAttachAfterDeploy:()=>Mc});async function Mc(e,t,r){let n=we.workspace.getConfiguration("serviceFabric"),i=so(n.get(Rc)??ro,5,300,ro),o=so(n.get(Ec)??to,1,50,to),s=new de(e.clusterEndpoint),a={applicationName:e.applicationName,applicationTypeName:e.applicationTypeName,clusterEndpoint:e.clusterEndpoint,clusterKind:e.clusterKind},c={readyTimeoutMs:i*1e3,maxSessions:o,pollIntervalMs:Fc,getSetting:()=>Ic(),updateSetting:async p=>{await we.workspace.getConfiguration("serviceFabric").update(ao,p,we.ConfigurationTarget.Workspace)},getMementoFlag:p=>e.memento.get(p)===!0,setMementoFlag:async(p,d)=>{await e.memento.update(p,d)},showFirstDeployPrompt:()=>jc(),showInfo:p=>{we.window.showInformationMessage(p)},showWarning:async(p,...d)=>we.window.showWarningMessage(p,...d),showOutputChannel:()=>t.outputChannel.show(!0),ensureDebuggerAvailable:()=>jr("coreclr",t),listServices:p=>s.listServices(p),listReplicas:p=>s.listReplicas(p),getNodeNames:async()=>{try{return(await s.getNodes()).map(d=>d.name)}catch(p){return t.warn(`Auto-attach: failed to enumerate cluster nodes: ${p instanceof Error?p.message:String(p)}`),[]}},getDeployedCodePackages:(p,d)=>s.getDeployedCodePackages(p,d),startDebugging:p=>Promise.resolve(we.debug.startDebugging(void 0,p)),sleep:p=>new Promise(d=>setTimeout(d,p))},l={event:(p,d)=>r.event(p,d)},u={info:p=>t.info(p),warn:p=>t.warn(p),error:(p,d)=>t.error(p,d),debug:p=>t.debug(p)};try{await Fr(c,a,u,l)}catch(p){t.warn(`Auto-attach orchestrator threw: ${p instanceof Error?p.message:String(p)}`)}}function Ic(){return we.workspace.getConfiguration("serviceFabric").get(ao)==="localOnly"?"localOnly":"never"}function so(e,t,r,n){return Number.isFinite(e)?e<t?t:e>r?r:e:n}async function jc(){switch(await we.window.showInformationMessage("Service Fabric: Publish completed. Auto-attach the debugger after future local-cluster Publishes?",{modal:!0},no,io,oo)){case no:return"attach-once-localOnly";case oo:return"dont-ask-again";case io:return"never-this-time";default:return}}var we,ao,Ec,Rc,to,ro,Fc,no,io,oo,lo=Ie(()=>{"use strict";we=y(require("vscode"));zi();ze();Lr();ao="debug.autoAttachOnPublish",Ec="debug.autoAttachMaxSessions",Rc="debug.autoAttachReadyTimeoutSec",to=5,ro=30,Fc=1e3,no="Yes",io="Not now",oo="Don't ask again"});function os(e,t,r,n,i){let o=e??"",s=o.toLowerCase();if(/no\s+valid\s+certificate/i.test(o))return{kind:"missing"};if(/is\s+not\s+trusted/i.test(o)||/trust\s+the\s+certificate/i.test(s))return{kind:"untrusted"};let a=/(?:NotAfter|Expires?)\s*[:=]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[Tt][0-9:.+\-Zz]*)?)/.exec(o);if(a){let c=Date.parse(a[1]),l=Date.parse(n);if(!Number.isNaN(c)&&!Number.isNaN(l)){let p=Math.floor((c-l)/864e5);return p<0?{kind:"expired",daysOverdue:-p}:i>0&&p<=i?{kind:"expiring",daysRemaining:p}:{kind:"valid",daysRemaining:p}}}return r===0&&/valid/i.test(o)?{kind:"valid",daysRemaining:Number.POSITIVE_INFINITY}:{kind:"unparseable",raw:o}}var ss=Ie(()=>{"use strict"});var ls={};bt(ls,{runDevCertTrust:()=>Hl});async function Hl(e,t,r="manual"){let n=process.platform,o=Q.workspace.getConfiguration("serviceFabric").get("devCert.expirationWarningDays",30);e.info(`Dev-cert trust: starting (platform=${n}, trigger=${r}).`);let s=await wt("dotnet",["dev-certs","https","--check","--verbose"],e);if(s.spawnError)return Q.window.showErrorMessage("Could not run 'dotnet dev-certs'. Install the .NET SDK and ensure 'dotnet' is on PATH.","Open .NET Download").then(c=>{c==="Open .NET Download"&&Q.env.openExternal(Q.Uri.parse(Wl))}),Oe(t,r,n,"tooling-missing"),"tooling-missing";let a=os(s.stdout,s.stderr,s.exitCode??0,new Date().toISOString(),o);if(e.info(`Dev-cert probe: ${a.kind}`),n==="linux")return await Kl(a,e,t,r);if(a.kind==="valid"){let c=Number.isFinite(a.daysRemaining)?`${a.daysRemaining} day(s)`:"long";return Q.window.showInformationMessage(`ASP.NET Core HTTPS dev certificate is valid and trusted (${c} remaining).`),Oe(t,r,n,"already-trusted"),"already-trusted"}if(a.kind==="expiring")return await Q.window.showWarningMessage(`ASP.NET Core HTTPS dev certificate expires in ${a.daysRemaining} day(s). Regenerate now?`,"Regenerate","Not now")!=="Regenerate"?(Oe(t,r,n,"expiring-acknowledged"),"expiring-acknowledged"):await as(e,t,r,n);if(a.kind==="expired"||a.kind==="missing"||a.kind==="untrusted"){let c=a.kind==="expired"?`expired ${a.daysOverdue} day(s) ago`:a.kind==="missing"?"is not present":"is not trusted";return await Q.window.showInformationMessage(`ASP.NET Core HTTPS dev certificate ${c}. Generate and trust it now?`,"Yes","No")!=="Yes"?(Oe(t,r,n,"declined"),"declined"):await as(e,t,r,n)}return e.warn(`Dev-cert --check produced unparseable output:
${a.raw}`),Q.window.showErrorMessage("Could not interpret 'dotnet dev-certs https --check' output. See the Service Fabric output channel.","Open Output Channel").then(c=>{c==="Open Output Channel"&&e.outputChannel.show()}),Oe(t,r,n,"failed"),"failed"}async function as(e,t,r,n){let i=await wt("dotnet",["dev-certs","https","--clean"],e);i.exitCode!==0&&e.warn(`dotnet dev-certs https --clean exited ${i.exitCode}; continuing to --trust.`);let o=await wt("dotnet",["dev-certs","https","--trust"],e);return o.spawnError||(o.exitCode??1)!==0?(Q.window.showErrorMessage("Failed to trust the ASP.NET Core HTTPS dev certificate. See the Service Fabric output channel for details.","Open Output Channel").then(s=>{s==="Open Output Channel"&&e.outputChannel.show()}),Oe(t,r,n,"failed"),"failed"):(Q.window.showInformationMessage("ASP.NET Core HTTPS dev certificate generated and trusted."),Oe(t,r,n,"regenerated"),"regenerated")}async function Kl(e,t,r,n){return e.kind==="valid"?(Q.window.showInformationMessage("ASP.NET Core HTTPS dev certificate is present."),Oe(r,n,"linux","already-trusted"),"already-trusted"):((e.kind==="missing"||e.kind==="expired")&&(await wt("dotnet",["dev-certs","https","--clean"],t),await wt("dotnet",["dev-certs","https"],t)),Q.window.showWarningMessage("Trust on Linux is distro-specific. The dev certificate has been (re)generated; follow the Microsoft docs to trust it manually.","Open Docs").then(i=>{i==="Open Docs"&&Q.env.openExternal(Q.Uri.parse(Gl))}),Oe(r,n,"linux","linux-manual"),"linux-manual")}function wt(e,t,r){return new Promise(n=>{let i="",o="",s;try{s=(0,cs.spawn)(e,t,{shell:!1})}catch(a){r.error(`Failed to spawn ${e} ${t.join(" ")}`,a),n({stdout:"",stderr:"",exitCode:null,spawnError:!0});return}s.stdout?.on("data",a=>{let c=a.toString("utf8");i+=c,r.outputChannel.append(c)}),s.stderr?.on("data",a=>{let c=a.toString("utf8");o+=c,r.outputChannel.append(c)}),s.on("error",a=>{r.error(`Subprocess ${e} errored`,a),n({stdout:i,stderr:o,exitCode:null,spawnError:!0})}),s.on("close",a=>{n({stdout:i,stderr:o,exitCode:a})})})}function Oe(e,t,r,n){e.event("devcert.trust",{trigger:t,platform:r,outcome:n})}var Q,cs,Gl,Wl,ps=Ie(()=>{"use strict";Q=y(require("vscode")),cs=require("child_process");ss();Gl="https://learn.microsoft.com/en-us/aspnet/core/security/enforcing-ssl#trust-the-aspnet-core-https-development-certificate",Wl="https://dotnet.microsoft.com/download"});var ql={};bt(ql,{activate:()=>zl,deactivate:()=>Xl});module.exports=ys(ql);var $=y(require("vscode"));var sn=y(require("vscode")),qe={error:0,warn:1,info:2,debug:3},rr=class{constructor(t){this.channel=t}level=qe.info;setLevel(t){this.level=qe[t]}error(t,r){this.level>=qe.error&&this.channel.appendLine(`[error] ${t}${r?" :: "+ws(r):""}`)}warn(t){this.level>=qe.warn&&this.channel.appendLine(`[warn] ${t}`)}info(t){this.level>=qe.info&&this.channel.appendLine(`[info] ${t}`)}debug(t){this.level>=qe.debug&&this.channel.appendLine(`[debug] ${t}`)}show(){this.channel.show(!0)}raw(t){this.channel.append(t)}get outputChannel(){return this.channel}};function ws(e){if(e instanceof Error)return`${e.message}
${e.stack??""}`;try{return JSON.stringify(e)}catch{return String(e)}}function an(){let e=sn.window.createOutputChannel("Service Fabric");return{logger:new rr(e),channel:e}}var Le=y(require("vscode"));var G=y(require("path")),qn=y(Gn());var lt=y(require("fs")),ve=y(require("path"));async function xt(e){return lt.promises.readFile(e,"utf8")}async function te(e){try{return await lt.promises.access(e),!0}catch{return!1}}async function Wn(e){try{return(await lt.promises.readdir(e,{withFileTypes:!0})).filter(r=>r.isDirectory()).map(r=>ve.join(e,r.name))}catch{return[]}}async function pt(e,t){try{return(await lt.promises.readdir(e,{withFileTypes:!0})).filter(n=>n.isFile()&&(!t||n.name.toLowerCase().endsWith(t.toLowerCase()))).map(n=>ve.join(e,n.name))}catch{return[]}}function Hn(e,t){return ve.isAbsolute(t)?ve.normalize(t):ve.normalize(ve.resolve(e,t.replace(/\\/g,ve.sep)))}var Kn=/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g;function Nt(e){let t=new Map;for(let[r,n]of e.intrinsics)t.set(r,n);t.set("Configuration",e.configuration),t.set("Platform",e.platform??"AnyCPU");for(let r of e.propertyGroups)if(!(r.condition!==void 0&&Aa(r.condition,t)!==!0))for(let{name:n,value:i}of r.properties)t.set(n,kt(i,t).value);return t}function kt(e,t,r={}){let n=r.maxIterations??16,i=e;for(let s=0;s<n;s++){let a=!1,c=i.replace(Kn,(l,u)=>{let p=t.get(u);return p===void 0?l:(a=!0,p)});if(!a)break;i=c}let o=new Set;for(let s of i.matchAll(Kn))o.add(s[1]);return{value:i,unresolved:[...o]}}function Aa(e,t){let r=e.trim(),n=/^'([^']*)'\s*(==|!=)\s*'([^']*)'$/.exec(r);if(!n)return"unevaluable";let i=kt(n[1],t).value.toLowerCase(),o=kt(n[3],t).value.toLowerCase();return n[2]==="=="?i===o:i!==o}function zn(e){return t=>kt(t,e)}var gr=new qn.XMLParser({ignoreAttributes:!1,attributeNamePrefix:"@_",allowBooleanAttributes:!0,parseAttributeValue:!1,parseTagValue:!1,trimValues:!0,isArray:(e,t,r,n)=>Ta.has(e)}),Ta=new Set(["ProjectReference","Parameter","ServiceManifestImport","CodePackage","ConfigPackage","DataPackage","Endpoint","PropertyGroup","ItemGroup","None","Content"]);async function Ea(e){let t=await xt(e),r=G.dirname(e),i=gr.parse(t)?.Project??{},o=je(i.PropertyGroup),s=je(i.ItemGroup),a=mr(o,"ProjectGuid"),c=mr(o,"ProjectVersion"),l=mr(o,"ApplicationPackageRootFolder")??"ApplicationPackageRoot",u=Fa(o),p=new Map([["MSBuildProjectName",G.basename(e,G.extname(e))],["MSBuildProjectFile",G.basename(e)],["MSBuildProjectExtension",G.extname(e)],["MSBuildProjectDirectory",r],["MSBuildThisFileDirectory",r+G.sep],["MSBuildThisFileFullPath",e]]),d=Nt({propertyGroups:u,intrinsics:p,configuration:"Debug"}),f=d.get("OutputPath"),m=d.get("PackageLocation"),v=new Set,h=g=>{if(g)for(let w of g.matchAll(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g))v.add(w[1])};h(f),h(m);let P=[];for(let g of s)for(let w of je(g.ProjectReference)){let b=w["@_Include"];typeof b=="string"&&b.length>0&&P.push(Hn(r,b))}return{path:e,directory:r,projectGuid:a,projectVersion:c,applicationPackageRootFolder:l,outputPath:f,packageLocation:m,projectReferences:P,propertyGroups:u,properties:d,intrinsics:p,unresolvedProperties:v.size>0?[...v]:void 0}}async function Ra(e){if(!await te(e))return;let t=await xt(e),n=gr.parse(t)?.ApplicationManifest;if(!n)return;let i=[],o=n.Parameters;if(o)for(let a of je(o.Parameter))typeof a["@_Name"]=="string"&&i.push({name:a["@_Name"],defaultValue:a["@_DefaultValue"]});let s=[];for(let a of je(n.ServiceManifestImport)){let c=a.ServiceManifestRef;c&&typeof c["@_ServiceManifestName"]=="string"&&s.push({name:c["@_ServiceManifestName"],version:c["@_ServiceManifestVersion"]??""})}return{path:e,applicationTypeName:n["@_ApplicationTypeName"]??"",applicationTypeVersion:n["@_ApplicationTypeVersion"]??"",parameters:i,serviceManifestRefs:s}}async function Xn(e){if(!await te(e))return;let t=await xt(e),n=gr.parse(t)?.ServiceManifest;if(!n)return;let i=[],o=n.Resources;if(o?.Endpoints)for(let l of je(o.Endpoints.Endpoint))typeof l["@_Name"]=="string"&&i.push({name:l["@_Name"],protocol:l["@_Protocol"],type:l["@_Type"],port:l["@_Port"]});let s=je(n.CodePackage).map(l=>l["@_Name"]).filter(l=>typeof l=="string"),a=je(n.ConfigPackage).map(l=>l["@_Name"]).filter(l=>typeof l=="string"),c=je(n.DataPackage).map(l=>l["@_Name"]).filter(l=>typeof l=="string");return{path:e,packageDirectory:G.dirname(e),name:n["@_Name"]??"",version:n["@_Version"]??"",endpoints:i,codePackages:s,configPackages:a,dataPackages:c}}async function Zn(e){let t=await Ea(e),r=G.join(t.directory,t.applicationPackageRootFolder),n=G.join(r,"ApplicationManifest.xml"),i=await Ra(n),o=[],s=new Set;for(let f of t.projectReferences){let m=G.dirname(f),v=G.join(m,"PackageRoot","ServiceManifest.xml");if(s.has(v))continue;let h=await Xn(v);h&&(o.push(h),s.add(v))}for(let f of await Wn(r)){let m=G.join(f,"ServiceManifest.xml");if(s.has(m))continue;let v=await Xn(m);v&&(o.push(v),s.add(m))}let a=await pt(G.join(t.directory,"PublishProfiles"),".xml"),c=await pt(G.join(t.directory,"ApplicationParameters"),".xml"),l=await pt(G.join(t.directory,"StartupServiceParameters"),".xml"),u=G.join(t.directory,"StartupServices.xml"),p=await te(u)?u:void 0,d=await pt(G.join(t.directory,"Scripts"),".ps1");return{sfproj:t,applicationManifest:i,serviceManifests:o,publishProfiles:a,applicationParameters:c,startupServiceParameters:l,startupServicesManifest:p,scripts:d}}function je(e){return e==null?[]:Array.isArray(e)?e:[e]}function mr(e,t){for(let r of e){let n=r?.[t];if(typeof n=="string")return n;if(n&&typeof n=="object"&&"#text"in n&&typeof n["#text"]=="string")return n["#text"]}}function Fa(e){let t=[];for(let r of e){if(!r||typeof r!="object")continue;let n=typeof r["@_Condition"]=="string"?r["@_Condition"]:void 0,i=[];for(let[o,s]of Object.entries(r))o.startsWith("@_")||o==="#text"||(typeof s=="string"?i.push({name:o,value:s}):s&&typeof s=="object"&&"#text"in s&&typeof s["#text"]=="string"&&i.push({name:o,value:s["#text"]}));t.push({condition:n,properties:i})}return t}var $t=class{constructor(t){this.logger=t}cache=new Map;emitter=new Le.EventEmitter;onDidChange=this.emitter.event;watchers=[];inflight;async initialize(){await this.refreshAll();let t=Le.workspace.createFileSystemWatcher("**/*.sfproj"),r=Le.workspace.createFileSystemWatcher("**/{ApplicationManifest.xml,ServiceManifest.xml}"),n=Le.workspace.createFileSystemWatcher("**/{PublishProfiles,ApplicationParameters,StartupServiceParameters,Scripts}/**"),i=Le.workspace.createFileSystemWatcher("**/StartupServices.xml");for(let o of[t,r,n,i])o.onDidChange(()=>this.scheduleRefresh()),o.onDidCreate(()=>this.scheduleRefresh()),o.onDidDelete(()=>this.scheduleRefresh()),this.watchers.push(o);Le.workspace.onDidChangeWorkspaceFolders(()=>this.scheduleRefresh())}getProjects(){return[...this.cache.values()]}getProjectByPath(t){return this.cache.get(Yn(t))}scheduleRefresh(){this.inflight||(this.inflight=(async()=>{try{await this.refreshAll()}finally{this.inflight=void 0}})())}async refreshAll(){let t=await Le.workspace.findFiles("**/*.sfproj","**/node_modules/**"),r=new Set;for(let n of t){let i=Yn(n.fsPath);r.add(i);try{let o=await Zn(n.fsPath);this.cache.set(i,o)}catch(o){this.logger.warn(`Failed to load ${n.fsPath}: ${o.message}`),this.cache.delete(i)}}for(let n of[...this.cache.keys()])r.has(n)||this.cache.delete(n);this.emitter.fire()}dispose(){for(let t of this.watchers)t.dispose();this.emitter.dispose()}};function Yn(e){return e.replace(/\\/g,"/").toLowerCase()}var k=y(require("vscode")),Re=y(require("path")),re=class extends k.TreeItem{constructor(r,n,i,o,s,a){super(n,i);this.kind=r;this.project=o;this.resource=s;this.children=a;switch(this.contextValue=r,s&&(this.resourceUri=s),r){case"sfproj":this.iconPath=new k.ThemeIcon("package"),this.contextValue="sfproj";break;case"group":this.iconPath=new k.ThemeIcon("folder");break;case"serviceFolder":this.iconPath=new k.ThemeIcon("folder-library");break;case"packageFolder":this.iconPath=new k.ThemeIcon("folder");break;case"manifest":case"serviceManifest":this.iconPath=new k.ThemeIcon("file-code"),this.command=s?{command:"serviceFabric.openFile",title:"Open",arguments:[s]}:void 0;break;case"file":this.iconPath=k.ThemeIcon.File,this.command=s?{command:"serviceFabric.openFile",title:"Open",arguments:[s]}:void 0;break;case"projectRef":this.iconPath=new k.ThemeIcon("references"),this.command=s?{command:"serviceFabric.openFile",title:"Open",arguments:[s]}:void 0;break;case"message":this.iconPath=new k.ThemeIcon("info");break}}},At=class{constructor(t){this.watcher=t;t.onDidChange(()=>this.emitter.fire())}emitter=new k.EventEmitter;onDidChangeTreeData=this.emitter.event;refresh(){this.emitter.fire()}getTreeItem(t){return t}async getChildren(t){if(!t){let r=this.watcher.getProjects();return r.length===0?[]:r.map(n=>this.makeProjectNode(n))}return t.children??[]}makeProjectNode(t){let r=t.applicationManifest?.applicationTypeName||Re.basename(t.sfproj.path,".sfproj"),n=new re("sfproj",r,k.TreeItemCollapsibleState.Expanded,t,k.Uri.file(t.sfproj.path),this.buildProjectChildren(t)),i=t.applicationManifest?.applicationTypeVersion;return n.description=i?`v${i}`:void 0,n.tooltip=t.sfproj.path,n}buildProjectChildren(t){let r=[],n=Re.join(t.sfproj.directory,t.sfproj.applicationPackageRootFolder),i=k.Uri.file(n),o=[];t.applicationManifest?o.push(new re("manifest","ApplicationManifest.xml",k.TreeItemCollapsibleState.None,t,k.Uri.file(t.applicationManifest.path))):o.push(new re("message","ApplicationManifest.xml not found",k.TreeItemCollapsibleState.None));for(let s of t.serviceManifests)o.push(this.makeServiceFolderNode(t,s));if(r.push(new re("group",t.sfproj.applicationPackageRootFolder,k.TreeItemCollapsibleState.Expanded,t,i,o)),t.applicationParameters.length&&r.push(this.makeFileGroup(t,"ApplicationParameters",t.applicationParameters)),t.publishProfiles.length&&r.push(this.makeFileGroup(t,"PublishProfiles",t.publishProfiles)),t.startupServiceParameters.length&&r.push(this.makeFileGroup(t,"StartupServiceParameters",t.startupServiceParameters)),t.startupServicesManifest&&r.push(new re("manifest","StartupServices.xml",k.TreeItemCollapsibleState.None,t,k.Uri.file(t.startupServicesManifest))),t.scripts.length&&r.push(this.makeFileGroup(t,"Scripts",t.scripts)),t.sfproj.projectReferences.length){let s=t.sfproj.projectReferences.map(a=>new re("projectRef",Re.basename(a),k.TreeItemCollapsibleState.None,t,k.Uri.file(a)));r.push(new re("group","References",k.TreeItemCollapsibleState.Collapsed,t,void 0,s))}return r}makeServiceFolderNode(t,r){let n=Re.basename(r.packageDirectory),i=k.Uri.file(r.packageDirectory),o=[new re("serviceManifest","ServiceManifest.xml",k.TreeItemCollapsibleState.None,t,k.Uri.file(r.path))];for(let a of r.codePackages)o.push(new re("packageFolder",`Code (${a})`,k.TreeItemCollapsibleState.None,t,k.Uri.file(Re.join(r.packageDirectory,a))));for(let a of r.configPackages)o.push(new re("packageFolder",`Config (${a})`,k.TreeItemCollapsibleState.None,t,k.Uri.file(Re.join(r.packageDirectory,a))));for(let a of r.dataPackages)o.push(new re("packageFolder",`Data (${a})`,k.TreeItemCollapsibleState.None,t,k.Uri.file(Re.join(r.packageDirectory,a))));let s=new re("serviceFolder",n,k.TreeItemCollapsibleState.Collapsed,t,i,o);return s.description=r.version?`v${r.version}`:void 0,s}makeFileGroup(t,r,n){let i=n.map(o=>new re("file",Re.basename(o),k.TreeItemCollapsibleState.None,t,k.Uri.file(o)));return new re("group",r,k.TreeItemCollapsibleState.Collapsed,t,void 0,i)}};var ne=y(require("vscode")),He=class extends ne.TreeItem{constructor(r,n,i,o,s){super(n,i);this.kind=r;this.connection=o;this.children=s;switch(r){case"cluster":this.iconPath=new ne.ThemeIcon("server"),this.contextValue=o?o.connected?"cluster.connected":"cluster.disconnected":"cluster";break;case"group":this.iconPath=new ne.ThemeIcon("folder"),this.contextValue="cluster.group";break;case"app":this.iconPath=new ne.ThemeIcon("package"),this.contextValue="cluster.app";break;case"node":this.iconPath=new ne.ThemeIcon("vm"),this.contextValue="cluster.node";break;case"message":this.iconPath=new ne.ThemeIcon("info");break}}appName},Tt=class{constructor(t){this.store=t;t.onDidChange(()=>this.emitter.fire())}emitter=new ne.EventEmitter;onDidChangeTreeData=this.emitter.event;refresh(){this.emitter.fire()}getTreeItem(t){return t}async getChildren(t){if(!t){let r=this.store.list();return r.length===0?[]:r.map(n=>{let i=new He("cluster",n.label,ne.TreeItemCollapsibleState.Collapsed,n);return i.description=Ma(n),i.tooltip=Ia(n),i})}if(t.kind==="cluster"&&t.connection){let r=t.connection,n=[],i=(r.nodes??[]).map(a=>{let c=new He("node",a.name,ne.TreeItemCollapsibleState.None,r);return c.description=`${a.status} \u2022 ${a.healthState}`,c.tooltip=`Type: ${a.nodeType}
Status: ${a.status}
Health: ${a.healthState}`,c});n.push(Jn(`Nodes (${i.length})`,r,i,"No nodes reported"));let s=(r.deployedApplications??[]).map(a=>{let c=new He("app",a.name,ne.TreeItemCollapsibleState.None,r);return c.description=`${a.typeName} v${a.typeVersion} \u2022 ${a.status}`,c.appName=a.name,c});return n.push(Jn(`Applications (${s.length})`,r,s,"No deployed applications")),n}return t.children??[]}};function Jn(e,t,r,n){let i=r.length===0?[new He("message",n,ne.TreeItemCollapsibleState.None)]:r;return new He("group",e,ne.TreeItemCollapsibleState.Collapsed,t,i)}function Ma(e){if(!e.connected)return`${e.endpoint} (disconnected)`;let t=e.nodes?.length??0,r=e.deployedApplications?.length??0,n=t===1?"1-node":t===5?"5-node":`${t}-node`;return`${e.endpoint} \u2022 ${n} \u2022 ${e.aggregatedHealthState??"Unknown"} \u2022 ${r} app${r===1?"":"s"}`}function Ia(e){let t=[`${e.kind} cluster \u2014 ${e.endpoint}`];return e.connected?(t.push(`Health: ${e.aggregatedHealthState??"Unknown"}`),t.push(`Nodes: ${e.nodes?.length??0}`),t.push(`Applications: ${e.deployedApplications?.length??0}`)):t.push("Disconnected"),t.join(`
`)}var X=y(require("vscode"));function Ve(e,t,r){let n=[],i=new RegExp(`<(?:[A-Za-z_][\\w\\-.]*:)?${hr(t)}\\b([^>]*?)/?>`,"g"),o;for(;(o=i.exec(e))!==null;){let s=o.index,a=o.index+o[0].length,c=o[1],u=new RegExp(`\\b${hr(r)}\\s*=\\s*"([^"]*)"`).exec(c);if(u){let p=u.index+u[0].indexOf('"')+1,d=s+1+o[0].indexOf(c)+p,f=o[0],m=new RegExp(`\\b${hr(r)}\\s*=\\s*"`).exec(f);if(m){let v=s+m.index+m[0].length,h=v+u[1].length;n.push({value:u[1],valueRange:{start:v,end:h},elementRange:{start:s,end:a}})}else n.push({value:u[1],valueRange:{start:d,end:d+u[1].length},elementRange:{start:s,end:a}})}}return n}function dt(e){let t=[],r=/\[([A-Za-z_][\w\-.]*)\]/g,n;for(;(n=r.exec(e))!==null;)t.push({name:n[1],range:{start:n.index,end:n.index+n[0].length}});return t}function hr(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}var ja="service-fabric",Et=class{constructor(t){this.watcher=t;this.collection=X.languages.createDiagnosticCollection("serviceFabric"),this.disposables.push(this.collection),this.disposables.push(t.onDidChange(()=>this.refreshAll())),this.disposables.push(X.workspace.onDidSaveTextDocument(r=>this.refreshDocument(r))),this.disposables.push(X.workspace.onDidChangeTextDocument(r=>this.refreshDocument(r.document)))}collection;disposables=[];enabled=!0;setEnabled(t){this.enabled=t,t?this.refreshAll():this.collection.clear()}refreshAll(){if(this.enabled){this.collection.clear();for(let t of this.watcher.getProjects())this.diagnoseProject(t).catch(()=>{})}}refreshDocument(t){if(!this.enabled)return;let r=t.uri.fsPath.toLowerCase();if(!(!r.endsWith("applicationmanifest.xml")&&!r.endsWith("servicemanifest.xml"))){for(let n of this.watcher.getProjects())if(n.applicationManifest?.path===t.uri.fsPath||n.serviceManifests.some(o=>o.path===t.uri.fsPath)){this.diagnoseProject(n).catch(()=>{});return}}}async diagnoseProject(t){let r=t.applicationManifest;if(!r)return;let n=await X.workspace.openTextDocument(X.Uri.file(r.path)),i=n.getText(),o=[],s=new Set(r.parameters.map(p=>p.name)),a=dt(i);for(let p of a)s.has(p.name)||o.push(this.diag(n,p.range,X.DiagnosticSeverity.Error,"SFD001",`Parameter '${p.name}' is referenced but not declared in <Parameters>.`));let c=Ve(i,"ServiceManifestRef","ServiceManifestName"),l=Ve(i,"ServiceManifestRef","ServiceManifestVersion");for(let p of c){let d=t.serviceManifests.find(f=>f.name===p.value);if(!d)o.push(this.diag(n,p.valueRange,X.DiagnosticSeverity.Warning,"SFD003",`No ServiceManifest.xml found for service '${p.value}' under '${t.sfproj.applicationPackageRootFolder}/'.`));else{let f=l.find(m=>m.elementRange.start===p.elementRange.start);f&&d.version&&f.value!==d.version&&o.push(this.diag(n,f.valueRange,X.DiagnosticSeverity.Warning,"SFD004",`Version '${f.value}' in ApplicationManifest does not match on-disk ServiceManifest version '${d.version}'.`))}}let u=new Set(a.map(p=>p.name));for(let p of t.serviceManifests){let d=await X.workspace.openTextDocument(X.Uri.file(p.path)),f=d.getText(),m=[];for(let v of dt(f))u.add(v.name);this.collection.set(d.uri,m)}for(let p of r.parameters)if(!u.has(p.name)){let f=Ve(i,"Parameter","Name").find(m=>m.value===p.name);f&&o.push(this.diag(n,f.valueRange,X.DiagnosticSeverity.Information,"SFD002",`Parameter '${p.name}' is declared but never referenced.`))}this.collection.set(n.uri,o)}diag(t,r,n,i,o){let s=new X.Range(t.positionAt(r.start),t.positionAt(r.end)),a=new X.Diagnostic(s,o,n);return a.code=i,a.source=ja,a}dispose(){for(let t of this.disposables)t.dispose()}};var Ye=y(require("vscode"));var Rt=class{constructor(t){this.watcher=t}provideDefinition(t,r){if(!t.uri.fsPath.toLowerCase().endsWith("applicationmanifest.xml"))return;let i=this.watcher.getProjects().find(u=>u.applicationManifest?.path===t.uri.fsPath);if(!i)return;let o=t.getText(),s=Ve(o,"ServiceManifestRef","ServiceManifestName"),a=t.offsetAt(r),c=s.find(u=>a>=u.valueRange.start&&a<=u.valueRange.end);if(!c)return;let l=i.serviceManifests.find(u=>u.name===c.value);if(l)return new Ye.Location(Ye.Uri.file(l.path),new Ye.Position(0,0))}};var Fe=y(require("vscode"));var ut=class{constructor(t){this.watcher=t}static providedCodeActionKinds=[Fe.CodeActionKind.QuickFix];provideCodeActions(t,r,n){let i=[];for(let o of n.diagnostics)if(o.source==="service-fabric"){if(o.code==="SFD001")i.push(this.addParameterFix(t,o));else if(o.code==="SFD004"){let s=this.syncVersionFix(t,o);s&&i.push(s)}}return i}addParameterFix(t,r){let n=t.getText(),i=dt(n),o=t.offsetAt(r.range.start),a=i.find(v=>o>=v.range.start&&o<=v.range.end)?.name??t.getText(r.range).replace(/[\[\]]/g,""),c=new Fe.CodeAction(`Add parameter '${a}' to <Parameters>`,Fe.CodeActionKind.QuickFix);c.diagnostics=[r],c.isPreferred=!0;let l=new Fe.WorkspaceEdit,u=`
    <Parameter Name="${a}" DefaultValue="" />`,p=/<Parameters\s*>/i,d=/<\/Parameters>/i,f=p.exec(n),m=d.exec(n);if(f&&m){let v=m.index,h=t.positionAt(v);l.insert(t.uri,h,u.trimStart()+`
  `)}else{let v=/<ApplicationManifest[^>]*>/.exec(n);if(v){let h=v.index+v[0].length,P=t.positionAt(h);l.insert(t.uri,P,`
  <Parameters>
    <Parameter Name="${a}" DefaultValue="" />
  </Parameters>`)}}return c.edit=l,c}syncVersionFix(t,r){let n=this.watcher.getProjects().find(p=>p.applicationManifest?.path===t.uri.fsPath);if(!n)return;let i=t.getText(),o=Ve(i,"ServiceManifestRef","ServiceManifestName"),s=t.offsetAt(r.range.start),a=o.find(p=>s>=p.elementRange.start&&s<=p.elementRange.end);if(!a)return;let c=n.serviceManifests.find(p=>p.name===a.value);if(!c||!c.version)return;let l=new Fe.CodeAction(`Sync ServiceManifestVersion to '${c.version}'`,Fe.CodeActionKind.QuickFix);l.diagnostics=[r],l.isPreferred=!0;let u=new Fe.WorkspaceEdit;return u.replace(t.uri,r.range,c.version),l.edit=u,l}};var Je=y(require("vscode"));var ei=y(require("node:fs")),vr=y(require("node:path")),Qn="ServiceFabricServiceModel.xsd",La=["C:\\Program Files\\Microsoft SDKs\\Service Fabric\\schemas","C:\\Program Files (x86)\\Microsoft SDKs\\Service Fabric\\schemas","C:\\Program Files\\Microsoft Service Fabric\\bin\\Fabric\\Fabric.Code"];function yr(e={}){let t=e.exists??(n=>ei.existsSync(n)),r=[];if(e.override&&e.override.trim().length>0){let n=e.override.trim();n.toLowerCase().endsWith(".xsd")?r.push(n):r.push(vr.join(n,Qn))}for(let n of e.probe??La)n.toLowerCase().endsWith(".xsd")?r.push(n):r.push(vr.join(n,Qn));for(let n of r)if(t(n))return n}async function ti(e,t){let r=Je.extensions.getExtension("redhat.vscode-xml");if(!r){t.warn("redhat.vscode-xml is not installed; XML schema features will be limited.");return}let n;try{await r.activate(),n=r.exports}catch(c){t.warn(`Failed to activate redhat.vscode-xml: ${c.message}`);return}if(!n||typeof n.addXMLFileAssociations!="function"){t.debug("redhat.vscode-xml does not expose addXMLFileAssociations; relying on user settings.");return}let o=Je.workspace.getConfiguration("serviceFabric").get("xmlSchemaPath")??"",s=yr({override:o});if(!s){t.warn(`Service Fabric XSDs not found. Install the Service Fabric SDK (typically under "C:\\Program Files\\Microsoft SDKs\\Service Fabric\\schemas") or set "serviceFabric.xmlSchemaPath" to a folder containing ServiceFabricServiceModel.xsd. Manifest validation will fall back to the extension's in-house diagnostics only.`);return}let a=Je.Uri.file(s).toString();try{n.addXMLFileAssociations([{systemId:a,pattern:"**/ApplicationManifest.xml"},{systemId:a,pattern:"**/ServiceManifest.xml"}]),t.info(`Registered Service Fabric XSD with redhat.vscode-xml: ${s}`)}catch(c){t.warn(`Failed to register XML associations: ${c.message}`)}}var ie=y(require("vscode")),rt=y(require("path"));var ri=y(require("path")),ni=require("child_process");function Oa(){try{let r=require("vscode")?.workspace?.getConfiguration?.("serviceFabric")?.get?.("msbuildPath");return typeof r=="string"?r:""}catch{return""}}async function Qe(){let e=Oa();if(e&&await te(e))return{executable:e,leadingArgs:[],description:`override: ${e}`};if(process.platform==="win32"){let t=await Da();if(t)return{executable:t,leadingArgs:[],description:`vswhere: ${t}`}}return{executable:"dotnet",leadingArgs:["msbuild"],description:"dotnet msbuild (fallback)"}}async function Da(){let e=process.env["ProgramFiles(x86)"]??process.env.ProgramFiles??"C:\\Program Files (x86)",t=ri.join(e,"Microsoft Visual Studio","Installer","vswhere.exe");if(await te(t))return new Promise(r=>{let n=(0,ni.spawn)(t,["-latest","-products","*","-requires","Microsoft.Component.MSBuild","-find","MSBuild\\**\\Bin\\MSBuild.exe"],{windowsHide:!0}),i="";n.stdout.on("data",o=>i+=o.toString()),n.on("error",()=>r(void 0)),n.on("close",()=>{let o=i.split(/\r?\n/).map(a=>a.trim()).filter(Boolean),s=o.find(a=>/amd64\\MSBuild\.exe$/i.test(a))??o.find(a=>/Current\\Bin\\MSBuild\.exe$/i.test(a))??o[0];r(s)})})}var et=class e{constructor(t){this.watcher=t}static type="servicefabric";async provideTasks(t){let r=[];for(let n of this.watcher.getProjects())for(let i of["Build","Rebuild","Clean","Package"])r.push(await tt(n.sfproj.path,i));return r}async resolveTask(t,r){let n=t.definition;if(n.type!==e.type||!n.project||!n.target)return;let i=Va(n.project);if(i)return tt(i,n.target,n.configuration,n.platform,t.scope)}};function Va(e){if(rt.isAbsolute(e))return e;let t=ie.workspace.workspaceFolders?.[0];if(t)return rt.join(t.uri.fsPath,e)}async function tt(e,t,r="Debug",n="x64",i){let o=await Qe(),s=[...o.leadingArgs,e,`/t:${t}`,`/p:Configuration=${r}`,`/p:Platform=${n}`,"/nologo","/v:minimal"],a=new ie.ProcessExecution(o.executable,s),c={type:et.type,project:e,target:t,configuration:r,platform:n},l=new ie.Task(c,i??ie.TaskScope.Workspace,`${t} ${rt.basename(e)}`,"servicefabric",a,["$msCompile"]);return l.detail=`${o.description}`,l.group=t==="Build"||t==="Rebuild"?ie.TaskGroup.Build:t==="Clean"?ie.TaskGroup.Clean:ie.TaskGroup.Build,l.presentationOptions={echo:!0,reveal:ie.TaskRevealKind.Always,focus:!1,panel:ie.TaskPanelKind.Dedicated,clear:!0},l}var be=y(require("vscode"));var Y=y(require("fs")),J=y(require("path")),oi=y(require("https")),si=y(require("os")),ai=y(require("zlib")),br=require("child_process");var wr=y(require("path")),Sr=require("child_process");function Ua(){try{let r=require("vscode")?.workspace?.getConfiguration?.("serviceFabric")?.get?.("nugetPath");return typeof r=="string"?r:""}catch{return""}}async function ii(){let e=Ua();if(e&&await te(e))return{executable:e,description:`override: ${e}`,kind:"override"};if(process.platform==="win32"){let n=await _a();if(n)return{executable:n,description:`vswhere: ${n}`,kind:"vswhere"}}let t=await Ba();if(t)return{executable:t,description:`PATH: ${t}`,kind:"path"};let r=await Ga();if(r)return{executable:r,description:`profile: ${r}`,kind:"profile"}}async function _a(){let e=process.env["ProgramFiles(x86)"]??process.env.ProgramFiles??"C:\\Program Files (x86)",t=wr.join(e,"Microsoft Visual Studio","Installer","vswhere.exe");if(await te(t))return new Promise(r=>{let n=(0,Sr.spawn)(t,["-latest","-products","*","-find","Common7\\IDE\\CommonExtensions\\Microsoft\\NuGet\\NuGet.exe"],{windowsHide:!0}),i="";n.stdout.on("data",o=>i+=o.toString()),n.on("error",()=>r(void 0)),n.on("close",()=>{let o=i.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);r(o[0])})})}async function Ba(){let e=process.platform==="win32"?"where.exe":"which",t=process.platform==="win32"?"nuget.exe":"nuget";return new Promise(r=>{let n=(0,Sr.spawn)(e,[t],{windowsHide:!0}),i="";n.stdout.on("data",o=>i+=o.toString()),n.on("error",()=>r(void 0)),n.on("close",o=>{if(o!==0)return r(void 0);let s=i.split(/\r?\n/).map(a=>a.trim()).filter(Boolean);r(s[0])})})}async function Ga(){let e=process.env.USERPROFILE??process.env.HOME;if(!e)return;let t=wr.join(e,".nuget","nuget.exe");return await te(t)?t:void 0}function Wa(){try{return require("vscode")?.workspace?.workspaceFolders}catch{return}}async function ye(e,t){let r=t?.output,n=t?.progress,i=J.dirname(e),o=J.join(i,"packages.config"),s=Ha(i),a;try{let d=Y.readFileSync(o,"utf8");a=Ka(d)}catch{return{ok:!0,strategy:"skipped",message:`No packages.config alongside ${J.basename(e)}; nothing to restore.`,packagesDirectory:s,missingOnEntry:[]}}let c=a.filter(d=>!ci(s,d));if(c.length===0)return{ok:!0,strategy:"skipped",message:"NuGet packages are already restored.",packagesDirectory:s,missingOnEntry:[]};n?.report({message:`Restoring ${c.length} NuGet package(s)\u2026`}),r?.appendLine(`[nuget-restore] Missing: ${c.map(d=>`${d.id}.${d.version}`).join(", ")}`);let l=await ii();if(l){if(r?.appendLine(`[nuget-restore] Strategy B: ${l.description}`),await za(l.executable,e,s,r)&&Ft(s,a).length===0)return Pr("nuget-exe",s,c)}else r?.appendLine("[nuget-restore] Strategy B: nuget.exe not found; skipping.");if(r?.appendLine("[nuget-restore] Strategy C: msbuild /t:Restore /p:RestorePackagesConfig=true"),await Xa(e,s,r)&&Ft(s,a).length===0)return Pr("msbuild-restorepkgconfig",s,c);let p=Ft(s,a);if(p.length>0&&p.length<=4){r?.appendLine(`[nuget-restore] Strategy F: HTTP fetch from api.nuget.org for ${p.length} package(s)`);try{for(let d of p)n?.report({message:`Fetching ${d.id} ${d.version}\u2026`}),await qa(d,s,r);if(Ft(s,a).length===0)return Pr("http-fallback",s,c)}catch(d){let f=d instanceof Error?d.message:String(d);r?.appendLine(`[nuget-restore] Strategy F failed: ${f}`)}}return{ok:!1,strategy:"failed",message:"Could not restore the Service Fabric MSBuild targets. Install Visual Studio 2022 (any edition with the .NET workload), or run 'nuget restore <App>.sfproj -PackagesDirectory packages' manually, or check network connectivity to api.nuget.org.",packagesDirectory:s,missingOnEntry:c}}function Ha(e){let t=Wa();return t&&t.length>0?J.join(t[0].uri.fsPath,"packages"):J.join(J.dirname(e),"packages")}function Ka(e){let t=[],r=/<package\b([^/>]*)\/>/g,n;for(;(n=r.exec(e))!==null;){let i=n[1],o=/\bid\s*=\s*"([^"]+)"/i.exec(i),s=/\bversion\s*=\s*"([^"]+)"/i.exec(i);o&&s&&t.push({id:o[1],version:s[1]})}return t}function ci(e,t){let r=J.join(e,`${t.id}.${t.version}`);if(!Y.existsSync(r))return!1;let n=J.join(r,"build");if(Y.existsSync(n))return!0;try{return Y.readdirSync(r).length>0}catch{return!1}}function Ft(e,t){return t.filter(r=>!ci(e,r))}function Pr(e,t,r){return{ok:!0,strategy:e,packagesDirectory:t,missingOnEntry:r}}async function za(e,t,r,n){return new Promise(i=>{let o=(0,br.spawn)(e,["restore",t,"-PackagesDirectory",r,"-NonInteractive","-Verbosity","quiet"],{windowsHide:!0});o.stdout?.on("data",s=>n?.append(s.toString())),o.stderr?.on("data",s=>n?.append(s.toString())),o.on("error",s=>{n?.appendLine(`[nuget-restore] nuget.exe error: ${s.message}`),i(!1)}),o.on("close",s=>i(s===0))})}async function Xa(e,t,r){let n=await Qe();return new Promise(i=>{let o=[...n.leadingArgs,e,"/t:Restore","/p:RestorePackagesConfig=true",`/p:RestorePackagesPath=${t}`,"/nologo","/v:minimal"],s=(0,br.spawn)(n.executable,o,{windowsHide:!0});s.stdout?.on("data",a=>r?.append(a.toString())),s.stderr?.on("data",a=>r?.append(a.toString())),s.on("error",a=>{r?.appendLine(`[nuget-restore] msbuild error: ${a.message}`),i(!1)}),s.on("close",a=>i(a===0))})}async function qa(e,t,r){let n=`https://api.nuget.org/v3-flatcontainer/${e.id.toLowerCase()}/${e.version}/${e.id.toLowerCase()}.${e.version}.nupkg`;r?.appendLine(`[nuget-restore]   GET ${n}`);let i=J.join(si.tmpdir(),`sf-restore-${e.id}-${e.version}-${Date.now()}.nupkg`);try{await Za(n,i);let o=J.join(t,`${e.id}.${e.version}`);Y.mkdirSync(o,{recursive:!0}),await Ya(i,o)}finally{try{Y.unlinkSync(i)}catch{}}}function Za(e,t){return new Promise((r,n)=>{let i=(o,s)=>{oi.get(o,a=>{let c=a.statusCode??0;if((c===301||c===302||c===307||c===308)&&a.headers.location){if(s<=0){n(new Error(`Too many redirects fetching ${e}`));return}a.resume(),i(a.headers.location,s-1);return}if(c!==200){n(new Error(`HTTP ${c} fetching ${e}`));return}let l=Y.createWriteStream(t);a.pipe(l),l.on("finish",()=>l.close(u=>u?n(u):r())),l.on("error",n)}).on("error",n)};i(e,5)})}async function Ya(e,t){let r=Y.readFileSync(e),n=101010256,i=-1;for(let l=r.length-22;l>=Math.max(0,r.length-65557);l--)if(r.readUInt32LE(l)===n){i=l;break}if(i<0)throw new Error("Invalid nupkg: missing End-of-Central-Directory record.");let o=r.readUInt16LE(i+10),s=r.readUInt32LE(i+12),a=r.readUInt32LE(i+16);if(a+s>r.length)throw new Error("Invalid nupkg: central directory bounds out of range.");let c=a;for(let l=0;l<o;l++){if(r.readUInt32LE(c)!==33639248)throw new Error(`Invalid nupkg: bad central-directory header at offset ${c}.`);let u=r.readUInt16LE(c+10),p=r.readUInt32LE(c+20),d=r.readUInt32LE(c+24),f=r.readUInt16LE(c+28),m=r.readUInt16LE(c+30),v=r.readUInt16LE(c+32),h=r.readUInt32LE(c+42),P=r.slice(c+46,c+46+f).toString("utf8");if(c+=46+f+m+v,r.readUInt32LE(h)!==67324752)throw new Error(`Invalid nupkg: bad local file header for ${P}.`);let g=r.readUInt16LE(h+26),w=r.readUInt16LE(h+28),b=h+30+g+w,S=r.slice(b,b+p);if(P.endsWith("/")){let le=J.join(t,...P.split("/").filter(Boolean));Y.mkdirSync(le,{recursive:!0});continue}let z=Ja(P);if(!z)continue;let O=J.join(t,z);Y.mkdirSync(J.dirname(O),{recursive:!0});let j;if(u===0)j=S;else if(u===8)j=ai.inflateRawSync(S);else throw new Error(`Unsupported nupkg compression method ${u} for ${P}.`);if(j.length!==d)throw new Error(`Length mismatch extracting ${P}: ${j.length} != ${d}.`);Y.writeFileSync(O,j)}}function Ja(e){let t=e.split(/[\\/]+/).filter(r=>r!==""&&r!=="."&&r!=="..");if(t.length!==0)return t.join(J.sep)}async function Ke(e,t){if(t){let i=t.project?t.project.sfproj.path:t.resourceUri?.fsPath??(t instanceof be.Uri?t.fsPath:void 0);if(i){let o=e.getProjectByPath(i);if(o)return o;let s=e.getProjects().find(a=>i.toLowerCase().startsWith(a.sfproj.directory.toLowerCase()));if(s)return s}}let r=e.getProjects();if(r.length===0){be.window.showInformationMessage("No Service Fabric projects in this workspace.");return}return r.length===1?r[0]:(await be.window.showQuickPick(r.map(i=>({label:i.applicationManifest?.applicationTypeName??i.sfproj.path,description:i.sfproj.path,project:i})),{placeHolder:"Select a Service Fabric application project"}))?.project}async function ft(e,t,r,n){let i=await Ke(e,n);if(!i)return;let o=t.outputChannel,s=await be.window.withProgress({location:be.ProgressLocation.Notification,title:`Restoring NuGet packages for ${i.sfproj.path}\u2026`},c=>ye(i.sfproj.path,{output:o,progress:c}));if(!s.ok){t.error(`NuGet restore failed (${s.strategy}): ${s.message??"no details"}`),await be.window.showErrorMessage(`Service Fabric: NuGet restore failed. ${s.message??""}`,{modal:!0});return}s.strategy!=="skipped"?t.info(`NuGet restore succeeded via ${s.strategy}.`):t.debug("NuGet restore skipped (already up to date)."),t.info(`Running ${r} on ${i.sfproj.path}`);let a=await tt(i.sfproj.path,r);await be.tasks.executeTask(a)}var li=y(require("vscode")),Cr="serviceFabric.connections",nt="serviceFabric.activeClusterId",Mt=class{constructor(t){this.context=t}emitter=new li.EventEmitter;onDidChange=this.emitter.event;list(){return this.context.workspaceState.get(Cr,[])}get(t){return this.list().find(r=>r.id===t)}getActive(){let t=this.context.workspaceState.get(nt);return t?this.get(t):this.list()[0]}async setActive(t){await this.context.workspaceState.update(nt,t),this.emitter.fire()}async upsert(t){let r=this.list(),n=r.findIndex(i=>i.id===t.id);n>=0?r[n]=t:r.push(t),await this.context.workspaceState.update(Cr,r),this.context.workspaceState.get(nt)||await this.context.workspaceState.update(nt,t.id),this.emitter.fire()}async remove(t){let r=this.list().filter(i=>i.id!==t);await this.context.workspaceState.update(Cr,r),this.context.workspaceState.get(nt)===t&&await this.context.workspaceState.update(nt,r[0]?.id),this.emitter.fire()}dispose(){this.emitter.dispose()}};var mt=y(require("vscode"));ze();var rc="local",It=class{constructor(t,r){this.store=t;this.logger=r}async connect(){let t=mt.workspace.getConfiguration("serviceFabric").get("localCluster.endpoint")??"http://localhost:19080",r={id:rc,label:"Local Cluster",endpoint:t,kind:"local",connected:!1};await this.store.upsert(r),await this.store.setActive(r.id);let n=await this.refresh(r);return n?.connected?mt.window.showInformationMessage(`Connected to local Service Fabric cluster at ${t}.`):mt.window.showWarningMessage(`Could not reach local cluster at ${t}. Make sure the dev cluster is running.`),n}async refresh(t){let r=new de(t.endpoint);try{let n=await r.getClusterHealth(5e3),i=await r.getDeployedApplications(5e3).catch(()=>[]),o=await r.getNodes(5e3).catch(()=>[]),s={...t,connected:!0,aggregatedHealthState:n.aggregatedHealthState,deployedApplications:i,nodes:o};return this.logger.info(`Cluster ${t.endpoint} health=${n.aggregatedHealthState} nodes=${o.length} apps=${i.length}`),await this.store.upsert(s),s}catch(n){this.logger.warn(`Cluster probe failed: ${n.message}`);let i={...t,connected:!1,deployedApplications:[],nodes:[],aggregatedHealthState:void 0};return await this.store.upsert(i),i}}};var Lt=y(require("vscode")),jt=class{constructor(t,r,n){this.store=t;this.local=r;this.logger=n;this.item=Lt.window.createStatusBarItem(Lt.StatusBarAlignment.Left,80),this.item.command="serviceFabric.cluster.selectActive",t.onDidChange(()=>this.update()),this.update(),this.timer=setInterval(()=>this.poll(),3e4)}item;timer;update(){let t=this.store.getActive();if(!t){this.item.text="$(server) SF: not connected",this.item.tooltip="Click to select a Service Fabric cluster",this.item.show();return}let r=t.connected?"$(pass-filled)":"$(circle-slash)",n=t.nodes?.length??0,i=t.connected?n===1?"1-node":n===5?"5-node":n?`${n}-node`:"":"",o=i?` (${i})`:"";this.item.text=`${r} SF: ${t.label}${o}`;let s=[t.endpoint];t.connected?(s.push(`Health: ${t.aggregatedHealthState??"Unknown"}`),s.push(`Nodes: ${n}`),s.push(`Applications: ${t.deployedApplications?.length??0}`)):s.push("Disconnected"),s.push("Click to switch cluster"),this.item.tooltip=s.join(`
`),this.item.show()}async poll(){let t=this.store.getActive();if(!(!t||t.kind!=="local"))try{await this.local.refresh(t)}catch(r){this.logger.debug(`Status poll failed: ${r.message}`)}}dispose(){this.timer&&clearInterval(this.timer),this.item.dispose()}};var W=y(require("vscode"));var di=y(require("vscode")),ui=require("child_process");function xr(e,t){let r=[];for(let[n,i]of Object.entries(t))if(i!==void 0){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))throw new Error(`Invalid PowerShell parameter name: ${n}`);r.push(`$${n} = ${nc(i)}`)}return r.length===0?e:r.join(`
`)+`
`+e}function nc(e){return typeof e=="boolean"?e?"$true":"$false":typeof e=="number"&&Number.isFinite(e)?String(e):`'${(typeof e=="string"?e:String(e)).replace(/'/g,"''")}'`}async function Ue(e,t,r,n,i={}){let o=ic(),s=xr(t,r),a=["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",s];e.info(`Running ${o} (script length ${s.length} chars)`);let c=i.capture?[]:void 0;return new Promise((l,u)=>{let p=(0,ui.spawn)(o,a,{windowsHide:!0});n?.onCancellationRequested(()=>p.kill("SIGTERM"));let d=f=>{let m=f.toString();e.raw(m),c?.push(m)};p.stdout.on("data",d),p.stderr.on("data",d),p.on("error",f=>u(f)),p.on("close",(f,m)=>{if(m){u(new Error(`PowerShell terminated by signal ${m}`));return}l({exitCode:f??-1,output:c?c.join(""):void 0})})})}function ic(){let e=di.workspace.getConfiguration("serviceFabric").get("powerShell.executable")??"auto";return e==="pwsh"?"pwsh":e==="powershell"||process.platform==="win32"?"powershell":"pwsh"}async function kr(e){let t=W.workspace.getConfiguration("serviceFabric").get("localCluster.nodeCount")??"5",r=[{label:"1-node",description:"Fastest startup, no failover testing",detail:"Single replica per stateful service. Good for inner-loop development.",value:"1",picked:t==="1"},{label:"5-node",description:"Failover, placement constraints, rolling upgrades",detail:"Five-replica primary cluster. Closer to production behaviour.",value:"5",picked:t==="5"}];return(await W.window.showQuickPick(r,{placeHolder:`${e} 1-node or 5-node mode (current default: ${t}-node)`}))?.value}async function fi(e){await e.connect()}async function mi(e,t){let r=await W.window.showInputBox({prompt:"Enter Service Fabric HTTP gateway endpoint",placeHolder:"https://my-cluster.eastus.cloudapp.azure.com:19080",validateInput:o=>/^https?:\/\//.test(o)?null:"Must start with http:// or https://"});if(!r)return;let n=await W.window.showInputBox({prompt:"Display name for this cluster",value:new URL(r).hostname});if(!n)return;let i={id:`remote:${r}`,label:n,endpoint:r,kind:"remote",connected:!1};await e.upsert(i),await e.setActive(i.id),await t.refresh(i)}async function gi(e,t){let r=t??e.getActive();r&&await e.remove(r.id)}async function hi(e){let t=e.list();if(t.length===0){W.window.showInformationMessage('No clusters configured. Use "Connect to Local Cluster" first.');return}let r=await W.window.showQuickPick(t.map(n=>({label:n.label,description:n.endpoint,detail:n.connected?"Connected":"Disconnected",id:n.id})),{placeHolder:"Select active Service Fabric cluster"});r&&await e.setActive(r.id)}async function vi(e,t){if(process.platform!=="win32"){W.window.showWarningMessage("Local Service Fabric clusters are supported on Windows only.");return}let r=t??await kr("Start cluster as");if(!r)return;let i=`
$ErrorActionPreference = 'Stop'
$sdk = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Service Fabric SDK' -ErrorAction SilentlyContinue).FabricSDKInstallPath
if (-not $sdk) { Write-Error 'Service Fabric SDK is not installed.'; exit 2 }
$cluster = Join-Path $sdk 'ClusterSetup\\DevClusterSetup.ps1'
& $cluster ${r==="1"?"-CreateOneNodeCluster":""}
`;e.show(),e.info(`Starting ${r}-node local cluster...`),await Ue(e,i,{})}async function yi(e){if(process.platform!=="win32")return;let t=`
$ErrorActionPreference = 'Stop'
Stop-Service FabricHostSvc -Force -ErrorAction SilentlyContinue
`;e.show(),await Ue(e,t,{})}async function Nr(e,t){if(process.platform!=="win32"||(W.workspace.getConfiguration("serviceFabric").get("confirmDestructiveActions")??!0)&&await W.window.showWarningMessage("Reset the local Service Fabric cluster? All deployed applications will be removed.",{modal:!0},"Reset")!=="Reset")return;let n=t??await kr("Reset and restart cluster as");if(!n)return;let o=`
$ErrorActionPreference = 'Stop'
$sdk = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Service Fabric SDK' -ErrorAction SilentlyContinue).FabricSDKInstallPath
if (-not $sdk) { Write-Error 'Service Fabric SDK is not installed.'; exit 2 }
$clean = Join-Path $sdk 'ClusterSetup\\CleanCluster.ps1'
$setup = Join-Path $sdk 'ClusterSetup\\DevClusterSetup.ps1'
& $clean
& $setup ${n==="1"?"-CreateOneNodeCluster":""}
`;e.show(),e.info(`Resetting cluster to ${n}-node mode...`),await Ue(e,o,{})}async function wi(e){if(process.platform!=="win32"){W.window.showWarningMessage("Local Service Fabric clusters are supported on Windows only.");return}let t=await kr("Switch local cluster to");!t||(W.workspace.getConfiguration("serviceFabric").get("confirmDestructiveActions")??!0)&&await W.window.showWarningMessage(`Recreate local cluster as ${t}-node? All currently deployed applications will be removed.`,{modal:!0},"Recreate")!=="Recreate"||(await Nr(e,t),await W.workspace.getConfiguration("serviceFabric").update("localCluster.nodeCount",t,W.ConfigurationTarget.Global))}async function Si(e,t){let r=t??e.getActive();if(!r){W.window.showInformationMessage("No active cluster.");return}let n=`${r.endpoint.replace(/\/$/,"")}/Explorer/index.html`;await W.env.openExternal(W.Uri.parse(n))}var R=y(require("vscode")),Xe=y(require("fs/promises")),_=y(require("path"));ze();var Pi=/<Parameter\b[^>]*\bName\s*=\s*"([^"]+)"[^>]*\bValue\s*=\s*"([^"]*)"[^>]*\/?>/gi,bi=/<Parameter\b[^>]*\bValue\s*=\s*"([^"]*)"[^>]*\bName\s*=\s*"([^"]+)"[^>]*\/?>/gi;function ki(e){let t={};Pi.lastIndex=0;let r;for(;(r=Pi.exec(e))!==null;)t[r[1]]=r[2];for(bi.lastIndex=0;(r=bi.exec(e))!==null;)r[2]in t||(t[r[2]]=r[1]);return t}function oc(e){let t=Object.keys(e);return t.length===0?"@{}":`@{ ${t.map(n=>`'${Ci(n)}' = '${Ci(e[n])}'`).join("; ")} }`}function Ci(e){return e.replace(/'/g,"''")}function Ni(e={}){let t=["$ErrorActionPreference = 'Stop'","try {","    Import-Module ServiceFabric -Global -ErrorAction Stop","} catch {",`    throw "The 'ServiceFabric' PowerShell module isn't available. Install the Service Fabric SDK and restart VS Code so it picks up the updated PSModulePath. Inner error: $($_.Exception.Message)"`,"}","$splat = @{","    ApplicationPackagePath = $PackagePath","    PublishProfileFile = $PublishProfile","}"],r=e.applicationParameter;return r&&Object.keys(r).length>0&&t.push(`$splat['ApplicationParameter'] = ${oc(r)}`),e.startupServicesFile&&e.startupServicesFile.trim().length>0&&t.push("$splat['StartupServicesFile'] = $StartupServicesFile"),t.push(". $DeployScript @splat"),t.join(`
`)}var sc=/<ClusterConnectionParameters\b([^>]*)>/i,$i=e=>new RegExp(`\\b${e}\\s*=\\s*"([^"]*)"`,"i");function $r(e){let t=xi(e,"ApplicationParameterFile"),r=xi(e,"StartupServiceParameterFile"),n=sc.exec(e);if(!n)return{isLocal:!0,httpGatewayUrl:"http://localhost:19080",applicationParameterFile:t,startupServiceParameterFile:r};let i=n[1]??"",s=$i("ConnectionEndpoint").exec(i)?.[1]?.trim();if(!s)return{isLocal:!0,httpGatewayUrl:"http://localhost:19080",applicationParameterFile:t,startupServiceParameterFile:r};let a=ac(s,i);return{isLocal:!1,connectionEndpoint:s,httpGatewayUrl:a,applicationParameterFile:t,startupServiceParameterFile:r}}function xi(e,t){let n=new RegExp(`<${t}\\b([^>]*)/?>`,"i").exec(e);if(!n)return;let i=n[1]??"",s=$i("Path").exec(i)?.[1]?.trim();return s&&s.length>0?s:void 0}function ac(e,t){if(/^https?:\/\//i.test(e))try{return new URL(e).toString().replace(/\/$/,"")}catch{return}let r=/^([^:\s]+):(\d+)$/.exec(e);if(!r)return;let n=r[1];return`${/\bX509Credential\s*=\s*"true"/i.test(t)||/\bAadCredential\s*=\s*"true"/i.test(t)?"https":"http"}://${n}:19080`}var cc=[/Cluster connection instance is null/i,/FabricObjectClosedException/i,/Service Fabric cluster may not be connected/i,/Could not ping any of the provided Service Fabric gateway endpoints/i];function Ai(e){for(let t of cc)if(t.test(e))return"The deploy script could not reach the Service Fabric cluster. For local profiles, start the dev cluster first (Service Fabric: Start Local Cluster). For remote profiles, verify the publish profile's ClusterConnectionParameters and certificate settings."}function Fi(e,t,r){let n=(e.configuration??"Debug").trim()||"Debug",i=[],o=(s,a)=>{if(!s)return;let c=s.trim();if(!c)return;let l="";if(e.expand){let f=e.expand(c);f.value!==c&&(c=f.value,l=" (expanded)")}let p=(r(c)?c:t(e.sfprojDir,c)).replace(/[\\/]+$/,"");i.some(f=>f.path.toLowerCase()===p.toLowerCase())||i.push({path:p,source:a+l})};return o(e.settingOverride,"serviceFabric.deploy.packagePath"),o(e.packageLocation,"sfproj <PackageLocation>"),o(e.outputPath,"sfproj <OutputPath>"),o(t("pkg",n),`default pkg\\${n}`),o(t("bin",n,"pkg"),`bin\\${n}\\pkg`),o(t("bin",n),`bin\\${n}`),i}var gt=class extends Error{constructor(t){super(t),this.name="PublishCancelledByUserError"}};async function Mi(e,t,r={}){if(e.length===0&&!r.evaluateMsbuildProperties)throw new Error("No candidate package roots to probe. Configure serviceFabric.deploy.packagePath or rebuild the project.");let n=[],i=await Ti(e,t,r,n);if(i)return i;if(r.evaluateMsbuildProperties){let o=[];try{o=await r.evaluateMsbuildProperties()}catch{o=[]}if(o.length>0){let s=await Ti(o,t,r,n);if(s)return s}}throw new Error(`Could not locate ApplicationManifest.xml. Probed: ${n.join(", ")}. Set serviceFabric.deploy.packagePath to the folder that directly contains ApplicationManifest.xml, or enable serviceFabric.deploy.useMsbuildPropertyEvaluator if your <OutputPath>/<PackageLocation> references properties defined in Directory.Build.props or imported .targets.`)}async function Ti(e,t,r,n){for(let i of e){if(n.push(i.path),!await t.pathExists(i.path))continue;if(await ji(t,i.path))return await Ei(t,i,i.path,r),{path:i.path,source:i.source};let o=r.searchMaxDepth??2;if(o<1)continue;let s=await uc(t,i.path,o);if(s.length===1)return await Ei(t,i,s[0],r),{path:s[0],source:`${i.source} (nested)`};if(s.length>1){let a=await lc(t,s,r.expectedApplicationTypeName,r.onAmbiguous);if(a)return{path:a.path,source:`${i.source} ${a.sourceSuffix}`};let c=await pc(t,s);throw new Error(`Multiple application type folders contain ApplicationManifest.xml under ${i.path}: ${c}.${r.expectedApplicationTypeName?` None matched expected ApplicationTypeName '${r.expectedApplicationTypeName}'.`:""} Set serviceFabric.deploy.packagePath to disambiguate.`)}}}async function Ei(e,t,r,n){if(!n.onOverrideTypeMismatch||!n.expectedApplicationTypeName||!t.source.startsWith("serviceFabric.deploy.packagePath")||!e.readApplicationTypeName)return;let i=Ot(r,"ApplicationManifest.xml"),o=await e.readApplicationTypeName(i);if(o===void 0||o===n.expectedApplicationTypeName)return;if(!await n.onOverrideTypeMismatch({path:r,declaredApplicationTypeName:o,expectedApplicationTypeName:n.expectedApplicationTypeName}))throw new gt(`Publish cancelled \u2014 serviceFabric.deploy.packagePath resolved to a package with ApplicationTypeName '${o}', expected '${n.expectedApplicationTypeName}'. Path: ${r}.`)}async function lc(e,t,r,n){let i=await Ii(e,t);if(r){let o=i.filter(s=>s.applicationTypeName!==void 0&&s.applicationTypeName===r);if(o.length===1)return{path:o[0].path,sourceSuffix:`(matched ApplicationTypeName ${r})`}}if(n){let o=await n(i);if(o&&t.includes(o))return{path:o,sourceSuffix:"(picked by user)"}}}async function Ii(e,t){let r=e.readApplicationTypeName?.bind(e),n=[];for(let i of t){let o;if(r)try{o=await r(Ot(i,"ApplicationManifest.xml"))}catch{o=void 0}n.push({path:i,applicationTypeName:o})}return n}async function pc(e,t){return(await Ii(e,t)).map(n=>n.applicationTypeName?`${Ri(n.path)} [${n.applicationTypeName}]`:Ri(n.path)).join(", ")}async function ji(e,t){return e.pathExists(Ot(t,"ApplicationManifest.xml"))}var dc=new Set(["node_modules",".git",".vs",".vscode","obj","packages","bin","out","artifacts","_published","TestResults"]);async function uc(e,t,r){let n=[],i=[{path:t,depth:0}];for(;i.length>0;){let{path:o,depth:s}=i.shift();if(await ji(e,o)){n.push(o);continue}if(s>=r)continue;let a=await e.readDirectories(o);for(let c of a)dc.has(c)||i.push({path:Ot(o,c),depth:s+1})}return n}function Ot(...e){return e.filter(t=>t&&t.length>0).join("\\").replace(/[\\/]+/g,"\\")}function Ri(e){let t=/[^\\/]+$/.exec(e);return t?t[0]:e}var _e=y(require("fs/promises")),Li=y(require("os")),Ce=y(require("path")),Oi=require("child_process");var Ar=new Map;function Tr(e){return`${e.sfprojPath.toLowerCase()}::${e.mtimeMs}::${e.configuration}::${e.platform}`}async function Di(e,t,r,n={}){let i=n.platform??"AnyCPU",o=n.timeoutMs??15e3,s;try{s=(await _e.stat(e)).mtimeMs}catch(m){return r.warn(`MSBuild evaluator skipped: cannot stat ${e}: ${m.message}`),[]}let a={sfprojPath:e,mtimeMs:s,configuration:t,platform:i},c=Ar.get(Tr(a));if(c)return r.debug(`MSBuild evaluator cache hit for ${Ce.basename(e)} (${t}|${i}).`),c.candidates;let l;try{l=await Qe()}catch(m){return r.warn(`MSBuild evaluator skipped: ${m.message}.`),[]}if(!l||!l.executable)return r.warn("MSBuild evaluator skipped: MSBuild.exe not found."),[];let u=Ce.dirname(e),p=await fc(l,e,t,i,o,r)??await gc(l,e,t,i,o,r);if(!p)return Ar.set(Tr(a),{key:a,candidates:[]}),[];let d=[],f=(m,v)=>{if(!m)return;let h=m.trim();if(!h)return;let g=(Ce.isAbsolute(h)?h:Ce.join(u,h)).replace(/[\\/]+$/,"");d.some(w=>w.path.toLowerCase()===g.toLowerCase())||d.push({path:g,source:v})};return f(p.PackageLocation,"MSBuild -getProperty:PackageLocation"),f(p.OutputPath,"MSBuild -getProperty:OutputPath"),f(p.BuildOutputPath,"MSBuild -getProperty:BuildOutputPath"),Ar.set(Tr(a),{key:a,candidates:d}),d.length>0?r.info(`MSBuild evaluator produced ${d.length} package-path candidate(s): ${d.map(m=>`${m.source}=${m.path}`).join("; ")}`):r.warn(`MSBuild evaluator returned no usable values for ${Ce.basename(e)} (${t}|${i}).`),d}async function fc(e,t,r,n,i,o){let s=[...e.leadingArgs,t,"-nologo","-noconlog","-getProperty:OutputPath,PackageLocation,BuildOutputPath",`-p:Configuration=${r}`,`-p:Platform=${n}`],a=await Vi(e.executable,s,i);if(!a){o.warn("MSBuild evaluator: spawn failed for -getProperty: invocation.");return}if(a.exitCode!==0){o.debug(`MSBuild -getProperty: failed with exit ${a.exitCode}; will try inline-target fallback. stderr: ${Ui(a.stderr,240)}`);return}return mc(a.stdout)}function mc(e){let t=e.trim();if(!t)return{};if(t.startsWith("{"))try{let n=JSON.parse(t),i=n?.Properties??n;if(i&&typeof i=="object")return{OutputPath:typeof i.OutputPath=="string"?i.OutputPath:void 0,PackageLocation:typeof i.PackageLocation=="string"?i.PackageLocation:void 0,BuildOutputPath:typeof i.BuildOutputPath=="string"?i.BuildOutputPath:void 0}}catch{}let r={};for(let n of t.split(/\r?\n/)){let i=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(n);if(!i)continue;let o=i[1],s=i[2];o==="OutputPath"?r.OutputPath=s:o==="PackageLocation"?r.PackageLocation=s:o==="BuildOutputPath"&&(r.BuildOutputPath=s)}return r}async function gc(e,t,r,n,i,o){let s=await _e.mkdtemp(Ce.join(Li.tmpdir(),"sfproj-eval-")),a=Ce.join(s,"SfProjEval.targets"),c="__SFPROJ_EVAL__",l=`<?xml version="1.0" encoding="utf-8"?>
<Project>
  <Target Name="SfProjEvalGetProps">
    <Message Importance="High" Text="${c}|OutputPath=$(OutputPath)" />
    <Message Importance="High" Text="${c}|PackageLocation=$(PackageLocation)" />
    <Message Importance="High" Text="${c}|BuildOutputPath=$(BuildOutputPath)" />
  </Target>
</Project>
`;try{await _e.writeFile(a,l,"utf8");let u=[...e.leadingArgs,t,"-nologo","-noconlog","-target:SfProjEvalGetProps",`-p:Configuration=${r}`,`-p:Platform=${n}`,`-p:CustomAfterMicrosoftCommonTargets=${a}`,`-p:CustomAfterMicrosoftCommonCrossTargetingTargets=${a}`],p=await Vi(e.executable,u,i);if(!p){o.warn("MSBuild evaluator: inline-target spawn failed.");return}if(p.exitCode!==0){o.warn(`MSBuild inline-target evaluator failed (exit ${p.exitCode}). stderr: ${Ui(p.stderr,240)}`);return}let d={};for(let f of p.stdout.split(/\r?\n/)){let m=new RegExp(`${c}\\|([A-Za-z_][A-Za-z0-9_]*)=(.*)$`).exec(f);if(!m)continue;let v=m[2].trim();m[1]==="OutputPath"?d.OutputPath=v:m[1]==="PackageLocation"?d.PackageLocation=v:m[1]==="BuildOutputPath"&&(d.BuildOutputPath=v)}return d}catch(u){o.warn(`MSBuild inline-target evaluator failed: ${u.message}`);return}finally{try{await _e.rm(s,{recursive:!0,force:!0})}catch{}}}function Vi(e,t,r){return new Promise(n=>{let i="",o="",s=!1,a=(0,Oi.spawn)(e,[...t],{windowsHide:!0}),c=setTimeout(()=>{if(!s){s=!0;try{a.kill()}catch{}n({exitCode:-1,stdout:i,stderr:o+`
[timed out]`})}},r);a.stdout?.on("data",l=>i+=l.toString()),a.stderr?.on("data",l=>o+=l.toString()),a.on("error",()=>{s||(s=!0,clearTimeout(c),n(void 0))}),a.on("close",l=>{s||(s=!0,clearTimeout(c),n({exitCode:l??0,stdout:i,stderr:o}))})})}function Ui(e,t){return e?e.length<=t?e:e.slice(0,t)+"\u2026":""}Rr();async function po(e,t,r,n,i,o,s){if(process.platform!=="win32"){R.window.showWarningMessage("Deploy is supported on Windows only \u2014 the Service Fabric SDK is required.");return}let a=await Ke(e,i);if(!a)return;let c=await Oc(a.publishProfiles);if(!c)return;let l=await Vc(c,n),u=await Dc(a.applicationParameters,l.applicationParameterFileAbs);n.show(),n.info("Restoring NuGet packages...");let p=await R.window.withProgress({location:R.ProgressLocation.Notification,title:"Service Fabric: restoring NuGet packages\u2026"},x=>ye(a.sfproj.path,{output:n.outputChannel,progress:x}));if(!p.ok){n.error(`NuGet restore failed (${p.strategy}): ${p.message??"no details"}`),await R.window.showErrorMessage(`Service Fabric: NuGet restore failed. ${p.message??""}`,{modal:!0});return}p.strategy!=="skipped"&&n.info(`NuGet restore succeeded via ${p.strategy}.`),n.info("Packaging application...");let d=await tt(a.sfproj.path,"Package"),f=await R.tasks.executeTask(d);await new Promise((x,V)=>{let Se=R.tasks.onDidEndTaskProcess(Ee=>{Ee.execution===f&&(Se.dispose(),Ee.exitCode===0?x():V(new Error(`Package failed with exit code ${Ee.exitCode}.`)))})});let m=a.scripts.find(x=>/Deploy-FabricApplication\.ps1$/i.test(x));if(!m||!await te(m)){R.window.showErrorMessage("Deploy-FabricApplication.ps1 not found under Scripts/. Restore the script from a Visual Studio template.");return}let v=_.join(a.sfproj.directory,"pkg","Debug"),h="Debug",P=Nt({propertyGroups:a.sfproj.propertyGroups,intrinsics:a.sfproj.intrinsics,configuration:h}),g=zn(P),w=new Set,b=x=>{if(!x)return x;let V=g(x);for(let Se of V.unresolved)w.add(Se);return V.value},S=x=>{let V=g(x);for(let Se of V.unresolved)w.add(Se);return V},z=R.workspace.getConfiguration("serviceFabric").get("deploy.packagePath"),O=R.workspace.getConfiguration("serviceFabric").get("deploy.searchMaxDepth",2),j=2;Number.isInteger(O)&&O>=1&&O<=16?j=O:O!==2&&O!==void 0&&n.warn(`serviceFabric.deploy.searchMaxDepth=${O} is out of range [1, 16]; using default 2.`);let le=Fi({sfprojDir:a.sfproj.directory,configuration:h,outputPath:a.sfproj.outputPath,packageLocation:a.sfproj.packageLocation,settingOverride:b(z),expand:S},_.join,_.isAbsolute),se=R.workspace.getConfiguration("serviceFabric").get("deploy.useMsbuildPropertyEvaluator",!1);if(w.size>0&&!se&&o){let V=await Er({isPromptSuppressedBySetting:()=>R.workspace.getConfiguration("serviceFabric").get("deploy.suppressMsbuildEvaluatorPrompt",!1),showPrompt:async(Se,Ee)=>R.window.showWarningMessage(Se,{modal:!0},...Ee),persistEvaluatorSetting:async()=>{await R.workspace.getConfiguration("serviceFabric").update("deploy.useMsbuildPropertyEvaluator",!0,R.ConfigurationTarget.Workspace)},logger:n},{sfprojPath:a.sfproj.path,unresolvedTokens:w});if(V.cancelled){n.info("Publish cancelled by user \u2014 declined MSBuild property evaluator prompt.");return}se=V.useEvaluator}else w.size>0&&n.info(`Unresolved MSBuild properties in package-path candidates: ${[...w].map(x=>`$(${x})`).join(", ")}. ${se?"Tier 2 (MSBuild -getProperty) will attempt to resolve them.":"Resolution will fail unless serviceFabric.deploy.useMsbuildPropertyEvaluator is enabled or serviceFabric.deploy.packagePath is set to the package folder."}`);let Z=se?()=>Di(a.sfproj.path,h,n):void 0,ds=async x=>{let V=x.declaredApplicationTypeName??"<unreadable>",Ee=await R.window.showWarningMessage(`serviceFabric.deploy.packagePath points at a package whose ApplicationTypeName is '${V}', but the project declares '${x.expectedApplicationTypeName}'.

Path: ${x.path}

Continuing will publish the wrong application. This choice is not remembered.`,{modal:!0},"Continue Publish","Cancel Publish")==="Continue Publish";return n.info(`Override application-type mismatch (declared='${V}', expected='${x.expectedApplicationTypeName}'): `+(Ee?"user chose Continue Publish.":"user chose Cancel Publish (or dismissed).")),Ee},rn;try{let x=await Mi(le,Uc(),{searchMaxDepth:j,expectedApplicationTypeName:a.applicationManifest?.applicationTypeName,onAmbiguous:V=>_c(V,n),evaluateMsbuildProperties:Z,onOverrideTypeMismatch:ds});rn=x.path,x.path!==v&&n.info(`Resolved application package root: ${x.path} (via ${x.source})`)}catch(x){if(x instanceof gt){n.info("Publish cancelled by user \u2014 application type did not match.");return}R.window.showErrorMessage(x.message),n.error(x.message);return}let tr=t.getActive();tr&&tr.kind==="local"&&await r.refresh(tr);let nn;if(u)try{let x=await Xe.readFile(u,"utf8"),V=ki(x);Object.keys(V).length>0&&(nn=V,n.info(`Overriding ${Object.keys(V).length} application parameter(s) from ${_.basename(u)}.`))}catch(x){R.window.showErrorMessage(`Failed to read application parameters from ${_.basename(u)}: ${x.message}`);return}let us=Ni({applicationParameter:nn,startupServicesFile:a.startupServicesManifest});if(!await Lc(c,r,n))return;a.startupServicesManifest?n.info("StartupServices.xml found \u2014 services declared in it will be created after the application is registered."):n.info('No StartupServices.xml \u2014 only the application type will be registered and an empty application instance created. Add services in StartupServices.xml (or via "Add Service") to deploy them automatically.'),n.info(`Invoking ${m}`);let St=await Ue(n,us,{DeployScript:m,PackagePath:rn,PublishProfile:c,...a.startupServicesManifest?{StartupServicesFile:a.startupServicesManifest}:{}},void 0,{capture:!0});if(St.exitCode===0){R.window.showInformationMessage("Service Fabric deployment completed successfully.");let x=t.getActive();if(x&&await r.refresh(x),x&&o&&s&&a.applicationManifest)try{let{maybeAutoAttachAfterDeploy:V}=await Promise.resolve().then(()=>(lo(),co)),Se=a.applicationManifest.applicationTypeName,Ee=`fabric:/${Se.replace(/Type$/,"")}`;await V({applicationName:Ee,applicationTypeName:Se,clusterEndpoint:x.endpoint,clusterKind:x.kind==="local"?"local":"remote",memento:o},n,s)}catch(V){n.warn(`Auto-attach hook threw: ${V instanceof Error?V.message:String(V)}`)}}else{let x=Ai(St.output??"");x?(R.window.showErrorMessage(`Deployment failed (exit code ${St.exitCode}). ${x}`),n.error(x)):R.window.showErrorMessage(`Deployment failed (exit code ${St.exitCode}). See the Service Fabric output channel.`)}}async function Lc(e,t,r){let n;try{let a=await Xe.readFile(e,"utf8");n=$r(a)}catch(a){return r.warn(`Skipping cluster probe \u2014 failed to parse publish profile: ${a.message}`),!0}let i=n.httpGatewayUrl;if(!i)return r.warn("Skipping cluster probe \u2014 no HTTP gateway could be inferred from the publish profile."),!0;r.info(`Probing cluster gateway ${i}...`);let o=new de(i);try{return await o.getClusterHealth(5e3),r.info("Cluster probe ok."),!0}catch(a){r.warn(`Cluster probe failed: ${a.message}`)}if(n.isLocal){let a=await R.window.showErrorMessage(`Local Service Fabric cluster at ${i} isn't responding. The deploy script needs an active cluster connection.`,{modal:!0},"Start Local Cluster","Continue Anyway");if(a==="Start Local Cluster"){await R.commands.executeCommand("serviceFabric.cluster.startLocal");try{return await o.getClusterHealth(1e4),r.info("Cluster probe ok after start."),!0}catch(c){return R.window.showErrorMessage(`Cluster still unreachable after start: ${c.message}. Aborting deploy.`),!1}}return a==="Continue Anyway"?(r.warn("Continuing deploy despite cluster probe failure (user override)."),!0):!1}return await R.window.showErrorMessage(`Service Fabric cluster at ${i} isn't responding. Verify the publish profile's ClusterConnectionParameters and certificate settings.`,{modal:!0},"Continue Anyway")==="Continue Anyway"}async function Oc(e){if(e.length===0){R.window.showErrorMessage("No publish profiles found under PublishProfiles/.");return}return e.length===1?e[0]:(await R.window.showQuickPick(e.map(r=>({label:_.basename(r),description:r,value:r})),{placeHolder:"Select a publish profile"}))?.value}async function Dc(e,t){if(e.length===0)return;let r=R.workspace.getConfiguration("serviceFabric").get("deploy.promptForApplicationParameters")??!1;if(t&&!r)return;if(e.length===1&&!r)return e[0];let n=[{label:"$(circle-slash) (none \u2014 use publish profile default)",description:t?`From profile: ${_.basename(t)}`:"Use ApplicationParameterFile referenced by the publish profile",value:void 0,picked:!0},...e.map(o=>({label:_.basename(o),description:o,value:o,picked:t!==void 0&&_.normalize(o).toLowerCase()===_.normalize(t).toLowerCase()}))];return(await R.window.showQuickPick(n,{placeHolder:"Override application parameter file (advanced \u2014 leave default to use the file paired with the publish profile)"}))?.value}async function Vc(e,t){let r;try{r=await Xe.readFile(e,"utf8")}catch(c){return t.warn(`Could not read publish profile ${_.basename(e)} for parameter-file validation: ${c.message}`),{}}let n=$r(r),i=_.dirname(e),o=c=>{if(c)return _.isAbsolute(c)?c:_.resolve(i,c)},s=o(n.applicationParameterFile),a=o(n.startupServiceParameterFile);return n.applicationParameterFile?(s?await te(s):!1)?t.info(`Publish profile pairs with ApplicationParameterFile: ${_.basename(s)} (${n.applicationParameterFile}).`):t.warn(`Publish profile references missing ApplicationParameterFile: ${n.applicationParameterFile} (resolved to ${s}). Deploy will likely fail or fall back to manifest defaults.`):t.info("Publish profile has no <ApplicationParameterFile> \u2014 manifest defaults will be used."),n.startupServiceParameterFile&&((a?await te(a):!1)?t.info(`Publish profile pairs with StartupServiceParameterFile: ${_.basename(a)} (${n.startupServiceParameterFile}).`):t.warn(`Publish profile references missing StartupServiceParameterFile: ${n.startupServiceParameterFile} (resolved to ${a}). StartupServices.xml defaults will be used.`)),{applicationParameterFileAbs:s,startupServiceParameterFileAbs:a}}function Uc(){return{async pathExists(e){return te(e)},async readDirectories(e){try{return(await Xe.readdir(e,{withFileTypes:!0})).filter(r=>r.isDirectory()).map(r=>r.name)}catch{return[]}},async readApplicationTypeName(e){try{let t=await Xe.readFile(e,"utf8");return/<ApplicationManifest\b[^>]*\bApplicationTypeName\s*=\s*["']([^"']+)["']/i.exec(t)?.[1]}catch{return}}}}async function _c(e,t){t.info(`Multiple application packages found \u2014 prompting user to pick: ${e.map(i=>`${_.basename(i.path)}${i.applicationTypeName?` [${i.applicationTypeName}]`:""}`).join(", ")}`);let r=e.map(i=>({label:_.basename(i.path),description:i.applicationTypeName?`ApplicationTypeName: ${i.applicationTypeName}`:"ApplicationTypeName: (unreadable)",detail:i.path,value:i.path}));return(await R.window.showQuickPick(r,{placeHolder:"Multiple application packages found \u2014 pick the one to deploy",matchOnDescription:!0,matchOnDetail:!0}))?.value}var oe=y(require("vscode"));ze();function uo(e){if(!e||typeof e!="string")throw new Error(`Invalid Service Fabric endpoint: ${JSON.stringify(e)}`);let t;try{t=new URL(e.trim())}catch{throw new Error(`Invalid Service Fabric endpoint: '${e}'. Expected an http(s) URL like 'http://localhost:19080'.`)}if(!t.hostname)throw new Error(`Invalid Service Fabric endpoint: '${e}' has no host.`);let r=t.port||(t.protocol==="https:"?"443":"80"),n=Number.parseInt(r,10),i=n===19080?19e3:n;return`${t.hostname}:${i}`}async function fo(e,t,r,n,i){if(process.platform!=="win32"){oe.window.showWarningMessage("Remove is supported on Windows only \u2014 the Service Fabric SDK is required.");return}let o=await Ke(e,i);if(!o)return;let s=o.applicationManifest;if(!s){oe.window.showErrorMessage("Application manifest could not be loaded.");return}let a=t.getActive();if(!a){oe.window.showErrorMessage('No active cluster. Use "Connect to Local Cluster" first.');return}if((oe.workspace.getConfiguration("serviceFabric").get("confirmDestructiveActions")??!0)&&await oe.window.showWarningMessage(`Remove application '${s.applicationTypeName}' (v${s.applicationTypeVersion}) from ${a.label}?`,{modal:!0},"Remove")!=="Remove")return;let l;try{l=uo(a.endpoint)}catch(v){oe.window.showErrorMessage(`Cannot derive a client connection endpoint from ${a.endpoint}: ${v.message}`);return}if(!await Bc(a.endpoint,a.kind,n))return;let p=`fabric:/${s.applicationTypeName}`,d=`
$ErrorActionPreference = 'Stop'
try {
    Import-Module ServiceFabric -Global -ErrorAction Stop
} catch {
    throw "The 'ServiceFabric' PowerShell module isn't available. Install the Service Fabric SDK and restart VS Code so it picks up the updated PSModulePath. Inner error: $($_.Exception.Message)"
}
$null = Connect-ServiceFabricCluster -ConnectionEndpoint $ClientEndpoint -TimeoutSec 10

# 1-3. Find every application instance of this type (named or otherwise),
# walk replicas \u2192 services \u2192 application for each.
$apps = @(Get-ServiceFabricApplication -ApplicationTypeName "$ApplicationTypeName" -ErrorAction SilentlyContinue)
if ($apps.Count -gt 0) {
    Write-Host "Found $($apps.Count) application instance(s) of type '$ApplicationTypeName'."
    foreach ($app in $apps) {
        $appNameStr = $app.ApplicationName.OriginalString
        Write-Host "Tearing down '$appNameStr'..."

        $services = @(Get-ServiceFabricService -ApplicationName $app.ApplicationName -ErrorAction SilentlyContinue)
        foreach ($svc in $services) {
            $svcName = $svc.ServiceName.OriginalString
            # Force-remove replicas inside every partition so the service
            # remove doesn't stall on a stuck replica/instance.
            $partitions = @(Get-ServiceFabricPartition -ServiceName $svc.ServiceName -ErrorAction SilentlyContinue)
            foreach ($p in $partitions) {
                $replicas = @(Get-ServiceFabricReplica -PartitionId $p.PartitionId -ErrorAction SilentlyContinue)
                foreach ($r in $replicas) {
                    try {
                        Write-Host "    Remove-ServiceFabricReplica -NodeName '$($r.NodeName)' -PartitionId '$($p.PartitionId)' -ReplicaOrInstanceId '$($r.ReplicaOrInstanceId)' -ForceRemove"
                        Remove-ServiceFabricReplica -NodeName $r.NodeName -PartitionId $p.PartitionId -ReplicaOrInstanceId $r.ReplicaOrInstanceId -ForceRemove -ErrorAction Stop | Out-Null
                    } catch {
                        Write-Warning "    Replica force-remove skipped: $($_.Exception.Message)"
                    }
                }
            }
            try {
                Write-Host "  Remove-ServiceFabricService -ServiceName '$svcName' -Force -ForceRemove"
                Remove-ServiceFabricService -ServiceName $svc.ServiceName -Force -ForceRemove
            } catch {
                Write-Warning "  Service force-remove failed for '$svcName': $($_.Exception.Message). Continuing \u2014 application-level remove will retry."
            }
        }

        try {
            Write-Host "  Remove-ServiceFabricApplication -ApplicationName '$appNameStr' -Force"
            Remove-ServiceFabricApplication -ApplicationName $app.ApplicationName -Force
        } catch {
            Write-Warning "  Application remove failed for '$appNameStr': $($_.Exception.Message). Will still try to unregister the type."
        }
    }
} else {
    Write-Host "No live application instances of type '$ApplicationTypeName' found."
}

# 4. Wait for the cluster to actually reap the instances. Poll
# Get-ServiceFabricApplication -ApplicationTypeName until it returns empty
# (or we hit the timeout). Without this the next step racing the cluster
# triggers "Application type and version is still in use."
$deadline = (Get-Date).AddSeconds([int]$WaitSeconds)
while ((Get-Date) -lt $deadline) {
    $remaining = @(Get-ServiceFabricApplication -ApplicationTypeName "$ApplicationTypeName" -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) { break }
    Write-Host "Waiting for $($remaining.Count) application instance(s) of '$ApplicationTypeName' to finish deleting..."
    Start-Sleep -Seconds 2
}
$stillThere = @(Get-ServiceFabricApplication -ApplicationTypeName "$ApplicationTypeName" -ErrorAction SilentlyContinue)
if ($stillThere.Count -gt 0) {
    $names = ($stillThere | ForEach-Object { $_.ApplicationName.OriginalString }) -join ', '
    Write-Warning "Application instance(s) still present after $WaitSeconds s: $names. Skipping Unregister-ServiceFabricApplicationType to avoid 'still in use' error."
} else {
    # 5. Unregister every version of the type.
    $type = @(Get-ServiceFabricApplicationType -ApplicationTypeName "$ApplicationTypeName" -ErrorAction SilentlyContinue)
    foreach ($t in $type) {
        try {
            Write-Host "Unregister-ServiceFabricApplicationType -ApplicationTypeName '$ApplicationTypeName' -ApplicationTypeVersion '$($t.ApplicationTypeVersion)' -Force"
            Unregister-ServiceFabricApplicationType -ApplicationTypeName "$ApplicationTypeName" -ApplicationTypeVersion $t.ApplicationTypeVersion -Force
        } catch {
            Write-Warning "Unregister failed for version '$($t.ApplicationTypeVersion)': $($_.Exception.Message)"
        }
    }
    Write-Host "Application type '$ApplicationTypeName' removed."
}
`;n.show(),n.info(`Connecting to ${l} (client TCP) for remove...`);let f=oe.workspace.getConfiguration("serviceFabric").get("remove.waitSeconds")??30,m=await Ue(n,d,{ClientEndpoint:l,ApplicationName:p,ApplicationTypeName:s.applicationTypeName,WaitSeconds:String(Math.max(0,Math.floor(f)))});m.exitCode===0?(oe.window.showInformationMessage(`Removed ${p} from ${a.label}.`),await r.refresh(a)):oe.window.showErrorMessage(`Remove failed (exit code ${m.exitCode}). See the Service Fabric output channel.`)}async function Bc(e,t,r){r.info(`Probing cluster gateway ${e}...`);let n=new de(e);try{return await n.getClusterHealth(5e3),r.info("Cluster probe ok."),!0}catch(o){r.warn(`Cluster probe failed: ${o.message}`)}if(t==="local"){let o=await oe.window.showErrorMessage(`Local Service Fabric cluster at ${e} isn't responding. Remove needs an active cluster connection.`,{modal:!0},"Start Local Cluster","Continue Anyway");if(o==="Start Local Cluster"){await oe.commands.executeCommand("serviceFabric.cluster.startLocal");try{return await n.getClusterHealth(1e4),r.info("Cluster probe ok after start."),!0}catch(s){return oe.window.showErrorMessage(`Cluster still unreachable after start: ${s.message}. Aborting remove.`),!1}}return o==="Continue Anyway"}return await oe.window.showErrorMessage(`Service Fabric cluster at ${e} isn't responding. Verify the cluster is online and the connection settings are correct.`,{modal:!0},"Continue Anyway")==="Continue Anyway"}var q=y(require("vscode")),Kr=y(require("path")),zr=y(require("fs"));var T=y(require("fs")),E=y(require("path"));function Or(e){if(e.httpsEndpoint&&F(e.kind))return{name:e.httpsEndpoint.name??"ServiceHttpsEndpoint",port:e.httpsEndpoint.port??8443}}function ue(e){return e!=="guest"}function xe(e){return e==="stateful"||e==="actor"||e==="aspNetStateful"}function F(e){return e==="aspNetStateless"||e==="aspNetStateful"}function Gc(e){return F(e.kind)?"netcore":e.runtime??"netcore"}function go(e){let t=e.serviceName;return xe(e.kind)?[{name:`${t}_PartitionCount`,defaultValue:"1"},{name:`${t}_MinReplicaSetSize`,defaultValue:"3"},{name:`${t}_TargetReplicaSetSize`,defaultValue:"3"}]:[{name:`${t}_InstanceCount`,defaultValue:"-1"}]}function ho(e){let t=e.endpointName??"ServiceEndpoint",r=e.exeProgram??`${e.serviceName}.exe`,n;switch(e.kind){case"stateful":case"aspNetStateful":n=`<StatefulServiceType ServiceTypeName="${e.serviceTypeName}" HasPersistedState="true" />`;break;case"actor":return`<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${e.serviceName}Pkg"
                 Version="${e.version}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <!-- The content will be generated during build -->
</ServiceManifest>
`;case"guest":n=`<StatelessServiceType ServiceTypeName="${e.serviceTypeName}" UseImplicitHost="true" />`;break;case"aspNetStateless":case"stateless":default:n=`<StatelessServiceType ServiceTypeName="${e.serviceTypeName}" />`;break}let i=[`        <Program>${r}</Program>`];e.kind==="guest"&&e.guestArguments&&e.guestArguments.trim()!==""&&i.push(`        <Arguments>${Xc(e.guestArguments)}</Arguments>`),e.kind==="guest"?i.push(`        <WorkingFolder>${e.guestWorkingFolder??"CodePackage"}</WorkingFolder>`):F(e.kind)&&i.push("        <WorkingFolder>CodePackage</WorkingFolder>");let o=F(e.kind)?`
    <EnvironmentVariables>
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value=""/>
    </EnvironmentVariables>`:"",s,a=Or(e);if(e.kind==="aspNetStateful"&&!a)s="";else if(e.kind==="aspNetStateless"||e.kind==="aspNetStateful"){let c=e.endpointPort??8559,l=[`      <Endpoint Protocol="http" Name="${t}" Type="Input" Port="${c}" />`];a&&l.push(`      <Endpoint Protocol="https" Name="${a.name}" Type="Input" Port="${a.port}" />`),s=`
  <Resources>
    <Endpoints>
${l.join(`
`)}
    </Endpoints>
  </Resources>`}else e.kind==="stateful"?s=`
  <Resources>
    <Endpoints>
      <Endpoint Name="${t}" />
      <Endpoint Name="ReplicatorEndpoint" />
    </Endpoints>
  </Resources>`:s=`
  <Resources>
    <Endpoints>
      <Endpoint Name="${t}" />
    </Endpoints>
  </Resources>`;return`<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${e.serviceName}Pkg" Version="${e.version}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ServiceTypes>
    ${n}
  </ServiceTypes>
  <CodePackage Name="Code" Version="${e.version}">
    <EntryPoint>
      <ExeHost>
${i.join(`
`)}
      </ExeHost>
    </EntryPoint>${o}
  </CodePackage>
  <ConfigPackage Name="Config" Version="${e.version}" />${s}
</ServiceManifest>
`}function vo(){return`<?xml version="1.0" encoding="utf-8"?>
<Settings xmlns="http://schemas.microsoft.com/2011/01/fabric"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
</Settings>
`}function yo(e,t){let r=Dr(e,t),n=Wc(r,t);return Hc(n,t)}function Wc(e,t){let r=e,i=go(t).filter(s=>!new RegExp(`<Parameter\\s+Name="${Be(s.name)}"`,"i").test(r));if(i.length===0)return r;let o=i.map(s=>`    <Parameter Name="${s.name}" DefaultValue="${s.defaultValue}" />`).join(`
`);return/<Parameters\s*\/>/.test(r)?r=r.replace(/<Parameters\s*\/>/,`<Parameters>
${o}
  </Parameters>`):/<Parameters\b[^>]*>[\s\S]*?<\/Parameters>/.test(r)?r=r.replace(/(<\/Parameters>)/,`${o}
  $1`):r=r.replace(/(<ApplicationManifest\b[^>]*>)/,`$1
  <Parameters>
${o}
  </Parameters>`),r}function Dr(e,t){let r=e,i=(F(t.kind)?[{name:`${t.serviceName}_ASPNETCORE_ENVIRONMENT`,defaultValue:""}]:[]).filter(c=>!new RegExp(`<Parameter\\s+Name="${Be(c.name)}"`,"i").test(r));if(i.length>0){let c=i.map(l=>`    <Parameter Name="${l.name}" DefaultValue="${l.defaultValue}" />`).join(`
`);/<Parameters\s*\/>/.test(r)?r=r.replace(/<Parameters\s*\/>/,`<Parameters>
${c}
  </Parameters>`):/<Parameters\b[^>]*>[\s\S]*?<\/Parameters>/.test(r)?r=r.replace(/(<\/Parameters>)/,`${c}
  $1`):r=r.replace(/(<ApplicationManifest\b[^>]*>)/,`$1
  <Parameters>
${c}
  </Parameters>`)}let o;t.kind==="actor"?o="":F(t.kind)?o=`
    <ConfigOverrides />
    <EnvironmentOverrides CodePackageRef="code">
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value="[${t.serviceName}_ASPNETCORE_ENVIRONMENT]" />
    </EnvironmentOverrides>
  `:o=`
    <ConfigOverrides />
  `;let s=`  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="${t.serviceName}Pkg" ServiceManifestVersion="${t.version}" />${o}</ServiceManifestImport>`;return new RegExp(`<ServiceManifestRef\\s+ServiceManifestName="${Be(t.serviceName)}Pkg"`,"i").test(r)||(/<\/ServiceManifestImport>/.test(r)?r=qc(r,/<\/ServiceManifestImport>/g,c=>`${c}
${s}`):/<DefaultServices\b/.test(r)?r=r.replace(/(\s*<DefaultServices\b)/,`
${s}$1`):r=r.replace(/(\s*<\/ApplicationManifest>)/,`
${s}$1`)),r}function Hc(e,t){let r=e;if(new RegExp(`<Service\\s+Name="${Be(t.serviceName)}"`,"i").test(r))return r;let i=zc(t);return/<DefaultServices\b[^>]*\/>/.test(r)?r=r.replace(/<DefaultServices\b[^>]*\/>/,`<DefaultServices>
${i}
  </DefaultServices>`):/<\/DefaultServices>/.test(r)?r=r.replace(/(<\/DefaultServices>)/,`${i}
  $1`):r=r.replace(/(\s*<\/ApplicationManifest>)/,`
  <DefaultServices>
${i}
  </DefaultServices>$1`),r}function wo(e,t){if(t.kind==="actor")return e;let r=e,n=go(t).filter(o=>!new RegExp(`<Parameter\\s+Name="${Be(o.name)}"`).test(r));if(n.length>0){let o=n.map(s=>`    <Parameter Name="${s.name}" DefaultValue="${s.defaultValue}" />`).join(`
`);/<Parameters\s*\/>/.test(r)?r=r.replace(/<Parameters\s*\/>/,`<Parameters>
${o}
  </Parameters>`):/<\/Parameters>/.test(r)?r=r.replace(/(<\/Parameters>)/,`${o}
  $1`):r=r.replace(/(<StartupServicesManifest\b[^>]*>)/,`$1
  <Parameters>
${o}
  </Parameters>`)}if(!new RegExp(`<Service\\s+Name="${Be(t.serviceName)}"`,"i").test(r)){let o=Kc(t);/<Services\s*\/>/.test(r)?r=r.replace(/<Services\s*\/>/,`<Services>
${o}
  </Services>`):/<\/Services>/.test(r)?r=r.replace(/(<\/Services>)/,`${o}
  $1`):r=r.replace(/(\s*<\/StartupServicesManifest>)/,`
  <Services>
${o}
  </Services>$1`)}return r}function So(e,t,r){if(t.kind==="actor")return e;let n=[];if(xe(t.kind)){let a=r==="oneNode"?"1":"3",c=r==="oneNode"?"1":"3";n.push({name:`${t.serviceName}_PartitionCount`,defaultValue:"1"},{name:`${t.serviceName}_MinReplicaSetSize`,defaultValue:a},{name:`${t.serviceName}_TargetReplicaSetSize`,defaultValue:c})}else n.push({name:`${t.serviceName}_InstanceCount`,defaultValue:r==="oneNode"?"1":r==="fiveNode"?"3":"-1"});let i=e,o=n.filter(a=>!new RegExp(`<Parameter\\s+Name="${Be(a.name)}"`).test(i));if(o.length===0)return i;let s=o.map(a=>`    <Parameter Name="${a.name}" Value="${a.defaultValue}" />`).join(`
`);return/<Parameters\s*\/>/.test(i)?i=i.replace(/<Parameters\s*\/>/,`<Parameters>
${s}
  </Parameters>`):/<\/Parameters>/.test(i)?i=i.replace(/(<\/Parameters>)/,`${s}
  $1`):i=i.replace(/(<StartupServices\b[^>]*>)/,`$1
  <Parameters>
${s}
  </Parameters>`),i}function Kc(e){let t=e.serviceName;return xe(e.kind)?[`    <Service Name="${t}" ServicePackageActivationMode="ExclusiveProcess">`,`      <StatefulService ServiceTypeName="${e.serviceTypeName}" TargetReplicaSetSize="[${t}_TargetReplicaSetSize]" MinReplicaSetSize="[${t}_MinReplicaSetSize]">`,`        <UniformInt64Partition PartitionCount="[${t}_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />`,"      </StatefulService>","    </Service>"].join(`
`):[`    <Service Name="${t}" ServicePackageActivationMode="ExclusiveProcess">`,`      <StatelessService ServiceTypeName="${e.serviceTypeName}" InstanceCount="[${t}_InstanceCount]">`,"        <SingletonPartition />","      </StatelessService>","    </Service>"].join(`
`)}function zc(e){let t=e.serviceName;return xe(e.kind)?[`    <Service Name="${t}">`,`      <StatefulService ServiceTypeName="${e.serviceTypeName}" TargetReplicaSetSize="[${t}_TargetReplicaSetSize]" MinReplicaSetSize="[${t}_MinReplicaSetSize]">`,`        <UniformInt64Partition PartitionCount="[${t}_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />`,"      </StatefulService>","    </Service>"].join(`
`):[`    <Service Name="${t}">`,`      <StatelessService ServiceTypeName="${e.serviceTypeName}" InstanceCount="[${t}_InstanceCount]">`,"        <SingletonPartition />","      </StatelessService>","    </Service>"].join(`
`)}function Po(e,t,r){let n=[];if(F(t.kind)){let a=r==="cloud"?"":"Development";n.push({name:`${t.serviceName}_ASPNETCORE_ENVIRONMENT`,defaultValue:a})}let i=e,o=n.filter(a=>!new RegExp(`<Parameter\\s+Name="${Be(a.name)}"`).test(i));if(o.length===0)return i;let s=o.map(a=>`    <Parameter Name="${a.name}" Value="${a.defaultValue}" />`).join(`
`);return/<Parameters\s*\/>/.test(i)?i=i.replace(/<Parameters\s*\/>/,`<Parameters>
${s}
  </Parameters>`):/<\/Parameters>/.test(i)?i=i.replace(/(<\/Parameters>)/,`${s}
  $1`):i=i.replace(/(<Application\b[^>]*>)/,`$1
  <Parameters>
${s}
  </Parameters>`),i}function Vr(e){let t=e.toLowerCase();return t.includes("1node")||t.includes("one")||t.includes("local.dev")?"oneNode":t.includes("5node")||t.includes("five")?"fiveNode":"cloud"}function Be(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function Xc(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}function qc(e,t,r){let n=-1,i=null;t.lastIndex=0;let o;for(;(o=t.exec(e))!==null&&(n=o.index,i=o,!!t.global););return i===null||n<0?e:e.slice(0,n)+r(i[0])+e.slice(n+i[0].length)}function ke(e){let t=Gc(e),r=Zc(e.serviceName),n=e.rootNamespace?.trim()||bo(e.serviceName),i=e.exeProgram?.replace(/\.exe$/i,"")??e.serviceName,o=t==="netfx"?"net472":"net10.0",s=t==="netcore"?"win-x64":void 0;return{className:r,rootNamespace:n,assemblyName:i,targetFramework:e.targetFramework??o,sdkVersion:e.serviceFabricSdkVersion??"8.1.208",csprojDirName:e.csprojDirName??e.serviceName,runtime:t,runtimeIdentifier:s,actorTypeName:r,actorInterfaceName:`I${r}`}}function Zc(e){let t=e.replace(/[^A-Za-z0-9]/g,"");return t?/^[0-9]/.test(t)?`_${t}`:t:"Service"}function bo(e){return e.split(".").map(t=>t.replace(/[^A-Za-z0-9_]/g,"")).filter(t=>t.length>0).map(t=>/^[0-9]/.test(t)?`_${t}`:t).join(".")||"Service"}function Ut(e,t){if(!ue(e.kind))throw new Error(`buildCsharpProgramCs is only valid for C# kinds, got '${e.kind}'.`);let r=t??ke(e);return e.kind==="actor"?`using System;
using System.Threading;
using Microsoft.ServiceFabric.Actors.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// Entry point for the '${e.serviceName}' Service Fabric actor service.
    /// Generated by the VS Code Service Fabric extension.
    /// </summary>
    internal static class Program
    {
        private static void Main()
        {
            try
            {
                ActorRuntime.RegisterActorAsync<${r.actorTypeName}>(
                    (context, actorType) => new ActorService(context, actorType))
                    .GetAwaiter().GetResult();

                Thread.Sleep(Timeout.Infinite);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Actor host failed: {ex}");
                throw;
            }
        }
    }
}
`:F(e.kind)?`using System;
using System.Threading;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// Entry point for the '${e.serviceName}' Service Fabric ${mo(e.kind)} service.
    /// Generated by the VS Code Service Fabric extension.
    /// </summary>
    internal static class Program
    {
        private static void Main()
        {
            try
            {
                ServiceRuntime.RegisterServiceAsync(
                    "${e.serviceTypeName}",
                    context => new ${r.className}(context))
                    .GetAwaiter().GetResult();

                Thread.Sleep(Timeout.Infinite);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Service host failed: {ex}");
                throw;
            }
        }
    }
}
`:`using System;
using System.Threading;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// Entry point for the '${e.serviceName}' Service Fabric ${mo(e.kind)} service.
    /// Generated by the VS Code Service Fabric extension.
    /// </summary>
    internal static class Program
    {
        private static void Main()
        {
            try
            {
                ServiceRuntime.RegisterServiceAsync(
                    "${e.serviceTypeName}",
                    context => new ${r.className}(context))
                    .GetAwaiter().GetResult();

                Thread.Sleep(Timeout.Infinite);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Service host failed: {ex}");
                throw;
            }
        }
    }
}
`}function mo(e){switch(e){case"aspNetStateless":return"stateless ASP.NET Core";case"aspNetStateful":return"stateful ASP.NET Core";default:return e}}function _t(e,t){if(!ue(e.kind))throw new Error(`buildCsharpServiceCs is only valid for C# kinds, got '${e.kind}'.`);if(e.kind==="actor")throw new Error("buildCsharpServiceCs does not handle the 'actor' kind; use buildActorCs instead.");let r=t??ke(e);return e.kind==="aspNetStateless"?Yc(e,r):e.kind==="aspNetStateful"?Jc(e,r):e.kind==="stateful"?`using System;
using System.Collections.Generic;
using System.Fabric;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.ServiceFabric.Data.Collections;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// A minimal stateful Reliable Service. Replace <c>RunAsync</c> with your own logic.
    /// </summary>
    internal sealed class ${r.className} : StatefulService
    {
        public ${r.className}(StatefulServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceReplicaListener> CreateServiceReplicaListeners()
            => new ServiceReplicaListener[0];

        protected override async Task RunAsync(CancellationToken cancellationToken)
        {
            var counter = await this.StateManager.GetOrAddAsync<IReliableDictionary<string, long>>("counter");

            while (!cancellationToken.IsCancellationRequested)
            {
                using (var tx = this.StateManager.CreateTransaction())
                {
                    var current = await counter.TryGetValueAsync(tx, "value");
                    var next = current.HasValue ? current.Value + 1 : 0L;
                    await counter.SetAsync(tx, "value", next);
                    await tx.CommitAsync();
                }

                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            }
        }
    }
}
`:`using System;
using System.Collections.Generic;
using System.Fabric;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// A minimal stateless Reliable Service. Replace <c>RunAsync</c> with your own logic.
    /// </summary>
    internal sealed class ${r.className} : StatelessService
    {
        public ${r.className}(StatelessServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceInstanceListener> CreateServiceInstanceListeners()
            => new ServiceInstanceListener[0];

        protected override async Task RunAsync(CancellationToken cancellationToken)
        {
            long iterations = 0;
            while (!cancellationToken.IsCancellationRequested)
            {
                iterations++;
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            }
        }
    }
}
`}function Bt(e,t){if(e.kind!=="actor")throw new Error(`buildActorInterfaceCs is only valid for the 'actor' kind, got '${e.kind}'.`);let r=t??ke(e);return`using System.Threading.Tasks;
using Microsoft.ServiceFabric.Actors;

namespace ${r.rootNamespace}.Interfaces
{
    /// <summary>
    /// Public actor contract for ${r.actorTypeName}. Add the methods callers
    /// will invoke on a proxy obtained via
    /// <c>ActorProxy.Create&lt;${r.actorInterfaceName}&gt;(...)</c>.
    /// </summary>
    public interface ${r.actorInterfaceName} : IActor
    {
        Task<long> GetCountAsync();

        Task SetCountAsync(long count);
    }
}
`}function Gt(e,t){if(e.kind!=="actor")throw new Error(`buildActorCs is only valid for the 'actor' kind, got '${e.kind}'.`);let r=t??ke(e);return`using System.Threading.Tasks;
using Microsoft.ServiceFabric.Actors;
using Microsoft.ServiceFabric.Actors.Runtime;
using ${r.rootNamespace}.Interfaces;

namespace ${r.rootNamespace}
{
    /// <summary>
    /// Default virtual-actor implementation. Replace the demo state with the
    /// fields and methods your application needs.
    /// </summary>
    [StatePersistence(StatePersistence.Persisted)]
    internal sealed class ${r.actorTypeName} : Actor, ${r.actorInterfaceName}
    {
        public ${r.actorTypeName}(ActorService actorService, ActorId actorId)
            : base(actorService, actorId) { }

        public async Task<long> GetCountAsync()
        {
            var count = await this.StateManager.TryGetStateAsync<long>("count");
            return count.HasValue ? count.Value : 0L;
        }

        public Task SetCountAsync(long count)
        {
            return this.StateManager.SetStateAsync("count", count);
        }
    }
}
`}function Yc(e,t){let r=Or(e),n=r?`

                        // HTTPS URL resolved from the second SF endpoint.
                        var httpsEndpoint = serviceContext.CodePackageActivationContext
                            .GetEndpoint("${r.name}");
                        app.Urls.Add($"https://+:{httpsEndpoint.Port}");`:"";return`using System.Collections.Generic;
using System.Fabric;
using System.IO;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.ServiceFabric.Services.Communication.AspNetCore;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${t.rootNamespace}
{
    /// <summary>
    /// Stateless ASP.NET Core Reliable Service. The Kestrel host returned from
    /// <see cref="CreateServiceInstanceListeners"/> exposes the controllers
    /// declared under <c>Controllers/</c>.
    /// </summary>
    internal sealed class ${t.className} : StatelessService
    {
        public ${t.className}(StatelessServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceInstanceListener> CreateServiceInstanceListeners()
        {
            return new[]
            {
                new ServiceInstanceListener(serviceContext =>
                    new KestrelCommunicationListener(serviceContext, "ServiceEndpoint", (url, listener) =>
                    {
                        var builder = WebApplication.CreateBuilder();

                        builder.Services.AddSingleton(serviceContext);
                        builder.Services.AddControllers();

                        var app = builder.Build();

                        app.UseRouting();
                        app.MapControllers();

                        app.Urls.Add(url);${n}
                        return app;
                    }))
            };
        }
    }
}
`}function Jc(e,t){let r=Or(e),n=r?`

                        // HTTPS URL resolved from the second SF endpoint.
                        var httpsEndpoint = serviceContext.CodePackageActivationContext
                            .GetEndpoint("${r.name}");
                        app.Urls.Add($"https://+:{httpsEndpoint.Port}");`:"";return`using System.Collections.Generic;
using System.Fabric;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.ServiceFabric.Services.Communication.AspNetCore;
using Microsoft.ServiceFabric.Services.Communication.Runtime;
using Microsoft.ServiceFabric.Services.Runtime;

namespace ${t.rootNamespace}
{
    /// <summary>
    /// Stateful ASP.NET Core Reliable Service. The Kestrel host returned from
    /// <see cref="CreateServiceReplicaListeners"/> exposes the controllers
    /// declared under <c>Controllers/</c>; reliable collections are reachable
    /// via <c>this.StateManager</c>.
    /// </summary>
    internal sealed class ${t.className} : StatefulService
    {
        public ${t.className}(StatefulServiceContext context) : base(context) { }

        protected override IEnumerable<ServiceReplicaListener> CreateServiceReplicaListeners()
        {
            return new[]
            {
                new ServiceReplicaListener(serviceContext =>
                    new KestrelCommunicationListener(serviceContext, "ServiceEndpoint", (url, listener) =>
                    {
                        var builder = WebApplication.CreateBuilder();

                        builder.Services.AddSingleton(serviceContext);
                        builder.Services.AddSingleton(this.StateManager);
                        builder.Services.AddControllers();

                        var app = builder.Build();

                        app.UseRouting();
                        app.MapControllers();

                        app.Urls.Add(url);${n}
                        return app;
                    }))
            };
        }
    }
}
`}function Wt(e,t){if(!F(e.kind))throw new Error(`buildAspNetValuesControllerCs is only valid for ASP.NET kinds, got '${e.kind}'.`);return`using Microsoft.AspNetCore.Mvc;

namespace ${(t??ke(e)).rootNamespace}.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public sealed class ValuesController : ControllerBase
    {
        // GET api/values
        [HttpGet]
        public IEnumerable<string> Get()
        {
            return new[] { "value1", "value2" };
        }

        // GET api/values/5
        [HttpGet("{id}")]
        public string Get(int id)
        {
            return $"value-{id}";
        }
    }
}
`}function Ht(){return`{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  }
}
`}function Kt(){return`{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Information",
      "Microsoft.Hosting.Lifetime": "Information"
    }
  },
  "DetailedErrors": true
}
`}function it(e,t=8080){if(!ue(e.kind))throw new Error(`buildLaunchSettingsJson is only valid for C# kinds, got '${e.kind}'.`);let r=typeof t=="number"?{http:t}:t;if(r.https!==void 0&&!F(e.kind))throw new Error(`buildLaunchSettingsJson received an https port for non-ASP.NET kind '${e.kind}'.`);let n=e.serviceName;if(F(e.kind)){let i=r.https!==void 0?`https://localhost:${r.https};http://localhost:${r.http}`:`http://localhost:${r.http}`,o={ASPNETCORE_ENVIRONMENT:"Development"};return r.https!==void 0&&(o.ASPNETCORE_HTTPS_PORT=String(r.https)),JSON.stringify({profiles:{[n]:{commandName:"Project",launchBrowser:!0,launchUrl:"api/values",applicationUrl:i,environmentVariables:o}}},void 0,2)+`
`}return JSON.stringify({profiles:{[n]:{commandName:"Project",environmentVariables:{DOTNET_ENVIRONMENT:"Development"}}}},void 0,2)+`
`}function zt(e,t,r){if(!ue(e.kind))throw new Error(`buildCsharpCsproj is only valid for C# kinds, got '${e.kind}'.`);let n=r??ke(e),i=F(e.kind)?"Microsoft.NET.Sdk.Web":"Microsoft.NET.Sdk",o=F(e.kind)?"":`
    <OutputType>Exe</OutputType>`,s=n.csprojDirName,c=/[^A-Za-z0-9_]/.test(s)?`
    <RootNamespace>${bo(s)}</RootNamespace>`:"",l=n.runtime==="netcore"?`
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>`:"",u=n.runtime==="netcore"?`
    <ServerGarbageCollection>True</ServerGarbageCollection>
    <RuntimeIdentifier>${n.runtimeIdentifier??"win-x64"}</RuntimeIdentifier>
    <SelfContained>True</SelfContained>`:"",p=`
    <IsServiceFabricServiceProject>True</IsServiceFabricServiceProject>`,d=e.kind==="actor"?`
    <UpdateServiceFabricManifestEnabled>True</UpdateServiceFabricManifestEnabled>
    <ServicePackagePath>PackageRoot</ServicePackagePath>
    <ServicePackagePrefix>$(MSBuildProjectName)</ServicePackagePrefix>
    <FabActUtilWorkingDir>$(BaseIntermediateOutputPath)\\FabActUtilTemp</FabActUtilWorkingDir>
    <GenerateRuntimeConfigDevFile>true</GenerateRuntimeConfigDevFile>`:"",f=[];e.kind==="actor"?f.push(`    <PackageReference Include="Microsoft.ServiceFabric.Actors" Version="${n.sdkVersion}" />`):F(e.kind)?(f.push('    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="9.0.15" />'),f.push(`    <PackageReference Include="Microsoft.ServiceFabric.AspNetCore.Kestrel" Version="${n.sdkVersion}" />`)):f.push(`    <PackageReference Include="Microsoft.ServiceFabric.Services" Version="${n.sdkVersion}" />`);let m=e.kind==="actor"?`
  <ItemGroup>
    <ProjectReference Include="${t?.actorInterfacesProjectRelativePath??`..\\${s}.Interfaces\\${s}.Interfaces.csproj`}" />
  </ItemGroup>
`:"";return`<Project Sdk="${i}">

  <PropertyGroup>${o}
    <TargetFramework>${n.targetFramework}</TargetFramework>${c}${l}${p}${u}${d}
  </PropertyGroup>

  <ItemGroup>
${f.join(`
`)}
  </ItemGroup>${m}
</Project>
`}function Xt(e,t){if(e.kind!=="actor")throw new Error(`buildActorInterfacesCsproj is only valid for the 'actor' kind, got '${e.kind}'.`);let r=t??ke(e),n=r.runtime==="netcore"?`
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>`:"",i=r.runtime==="netcore"?`
    <RuntimeIdentifier>${r.runtimeIdentifier??"win-x64"}</RuntimeIdentifier>
    <SelfContained>True</SelfContained>`:"";return`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>${r.targetFramework}</TargetFramework>${n}${i}
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.ServiceFabric.Actors" Version="${r.sdkVersion}" />
  </ItemGroup>

</Project>
`}function qt(e,t,r){let n=t.replace(/\//g,"\\"),i=n.replace(/\\/g,"\\\\").replace(/\./g,"\\.");if(new RegExp(`<ProjectReference\\s+Include="(?:${i}|${t.replace(/[.\\/]/g,d=>"\\"+d)})"`,"i").test(e))return e;let a=(r?.kind?F(r.kind):!1)?`    <ProjectReference Include="${n}">
      <ServiceLaunchUrl>http://localhost:{ServicePort}/</ServiceLaunchUrl>
    </ProjectReference>`:`    <ProjectReference Include="${n}" />`,c=/<ItemGroup[^>]*>([\s\S]*?)<\/ItemGroup>/g,l,u=null;for(;(l=c.exec(e))!==null;)if(/<ProjectReference\b/.test(l[1])){u={start:l.index,end:l.index+l[0].length};break}if(u){let f=e.slice(u.start,u.end).replace(/(\s*<\/ItemGroup>)/,`
${a}$1`);return e.slice(0,u.start)+f+e.slice(u.end)}let p=`  <ItemGroup>
${a}
  </ItemGroup>
`;return/<Import\b[^>]*\/>/.test(e)?e.replace(/(\s*<Import\b[^>]*\/>)/,`
${p}$1`):e.replace(/(\s*<\/Project>)/,`
${p}$1`)}var Co=`<#
.SYNOPSIS
Deploys a Service Fabric application type to a cluster.

.DESCRIPTION
This script deploys a Service Fabric application type to a cluster.  It is invoked by Visual Studio when deploying a Service Fabric Application project.

.NOTES
WARNING: This script file is invoked by Visual Studio.  Its parameters must not be altered but its logic can be customized as necessary.

.PARAMETER PublishProfileFile
Path to the file containing the publish profile.

.PARAMETER StartupServicesFile
Path to the file containing the startup services for debugging.

.PARAMETER ApplicationPackagePath
Path to the folder of the packaged Service Fabric application.

.PARAMETER DeployOnly
Indicates that the Service Fabric application should not be created or upgraded after registering the application type.

.PARAMETER ApplicationParameter
Hashtable of the Service Fabric application parameters to be used for the application.

.PARAMETER UnregisterUnusedApplicationVersionsAfterUpgrade
Indicates whether to unregister any unused application versions that exist after an upgrade is finished.

.PARAMETER OverrideUpgradeBehavior
Indicates the behavior used to override the upgrade settings specified by the publish profile.
'None' indicates that the upgrade settings will not be overridden.
'ForceUpgrade' indicates that an upgrade will occur with default settings, regardless of what is specified in the publish profile.
'VetoUpgrade' indicates that an upgrade will not occur, regardless of what is specified in the publish profile.

.PARAMETER UseExistingClusterConnection
Indicates that the script should make use of an existing cluster connection that has already been established in the PowerShell session.  The cluster connection parameters configured in the publish profile are ignored.

.PARAMETER OverwriteBehavior
Overwrite Behavior if an application exists in the cluster with the same name. Available Options are Never, Always, SameAppTypeAndVersion. This setting is not applicable when upgrading an application.
'Never' will not remove the existing application. This is the default behavior.
'Always' will remove the existing application even if its Application type and Version is different from the application being created.
'SameAppTypeAndVersion' will remove the existing application only if its Application type and Version is same as the application being created.

.PARAMETER SkipPackageValidation
Switch signaling whether the package should be validated or not before deployment.

.PARAMETER SecurityToken
A security token for authentication to cluster management endpoints. Used for silent authentication to clusters that are protected by Azure Active Directory.

.PARAMETER CopyPackageTimeoutSec
Timeout in seconds for copying application package to image store.

.EXAMPLE
. Scripts\\Deploy-FabricApplication.ps1 -ApplicationPackagePath 'pkg\\Debug'

Deploy the application using the default package location for a Debug build.

.EXAMPLE
. Scripts\\Deploy-FabricApplication.ps1 -ApplicationPackagePath 'pkg\\Debug' -DoNotCreateApplication

Deploy the application but do not create the application instance.

.EXAMPLE
. Scripts\\Deploy-FabricApplication.ps1 -ApplicationPackagePath 'pkg\\Debug' -ApplicationParameter @{CustomParameter1='MyValue'; CustomParameter2='MyValue'}

Deploy the application by providing values for parameters that are defined in the application manifest.
#>

Param
(
    [String]
    $PublishProfileFile,

    [String]
    $StartupServicesFile,

    [String]
    $ApplicationPackagePath,

    [Switch]
    $DeployOnly,

    [Hashtable]
    $ApplicationParameter,

    [Boolean]
    $UnregisterUnusedApplicationVersionsAfterUpgrade,

    [String]
    [ValidateSet('None', 'ForceUpgrade', 'VetoUpgrade')]
    $OverrideUpgradeBehavior = 'None',

    [Switch]
    $UseExistingClusterConnection,

    [String]
    [ValidateSet('Never', 'Always', 'SameAppTypeAndVersion')]
    $OverwriteBehavior = 'Never',

    [Switch]
    $SkipPackageValidation,

    [String]
    $SecurityToken,

    [int]
    $CopyPackageTimeoutSec,

    [int]
    $RegisterApplicationTypeTimeoutSec
)

function Read-XmlElementAsHashtable
{
    Param (
        [System.Xml.XmlElement]
        $Element
    )

    $hashtable = @{}
    if ($Element.Attributes)
    {
        $Element.Attributes |
            ForEach-Object {
                $boolVal = $null
                if ([bool]::TryParse($_.Value, [ref]$boolVal)) {
                    $hashtable[$_.Name] = $boolVal
                }
                else {
                    $hashtable[$_.Name] = $_.Value
                }
            }
    }

    return $hashtable
}

function Read-PublishProfile
{
    Param (
        [ValidateScript({Test-Path $_ -PathType Leaf})]
        [String]
        $PublishProfileFile
    )

    $publishProfileXml = [Xml] (Get-Content $PublishProfileFile -Encoding UTF8)
    $publishProfile = @{}

    $publishProfile.ClusterConnectionParameters = Read-XmlElementAsHashtable $publishProfileXml.PublishProfile.Item("ClusterConnectionParameters")
    $publishProfile.UpgradeDeployment = Read-XmlElementAsHashtable $publishProfileXml.PublishProfile.Item("UpgradeDeployment")
    $publishProfile.CopyPackageParameters = Read-XmlElementAsHashtable $publishProfileXml.PublishProfile.Item("CopyPackageParameters")
    $publishProfile.RegisterApplicationParameters = Read-XmlElementAsHashtable $publishProfileXml.PublishProfile.Item("RegisterApplicationParameters")

    if ($publishProfileXml.PublishProfile.Item("UpgradeDeployment"))
    {
        $publishProfile.UpgradeDeployment.Parameters = Read-XmlElementAsHashtable $publishProfileXml.PublishProfile.Item("UpgradeDeployment").Item("Parameters")
        if ($publishProfile.UpgradeDeployment["Mode"])
        {
            $publishProfile.UpgradeDeployment.Parameters[$publishProfile.UpgradeDeployment["Mode"]] = $true
        }
    }

    $publishProfileFolder = (Split-Path $PublishProfileFile)
    $publishProfile.ApplicationParameterFile = [System.IO.Path]::Combine($PublishProfileFolder, $publishProfileXml.PublishProfile.ApplicationParameterFile.Path)
    $publishProfile.StartupServiceParameterFile = [System.IO.Path]::Combine($PublishProfileFolder, $publishProfileXml.PublishProfile.StartupServiceParameterFile.Path)

    return $publishProfile
}

$LocalFolder = (Split-Path $MyInvocation.MyCommand.Path)

if (!$PublishProfileFile)
{
    $PublishProfileFile = "$LocalFolder\\..\\PublishProfiles\\Local.xml"
}

if (!$ApplicationPackagePath)
{
    $ApplicationPackagePath = "$LocalFolder\\..\\pkg\\Release"
}

$ApplicationPackagePath = Resolve-Path $ApplicationPackagePath

$publishProfile = Read-PublishProfile $PublishProfileFile

if (-not $UseExistingClusterConnection)
{
    $ClusterConnectionParameters = $publishProfile.ClusterConnectionParameters
    if ($SecurityToken)
    {
        $ClusterConnectionParameters["SecurityToken"] = $SecurityToken
    }

    try
    {
        [void](Connect-ServiceFabricCluster @ClusterConnectionParameters)
    }
    catch [System.Fabric.FabricObjectClosedException]
    {
        Write-Warning "Service Fabric cluster may not be connected."
        throw
    }
}

$RegKey = "HKLM:\\SOFTWARE\\Microsoft\\Service Fabric SDK"
$ModuleFolderPath = (Get-ItemProperty -Path $RegKey -Name FabricSDKPSModulePath).FabricSDKPSModulePath
Import-Module "$ModuleFolderPath\\ServiceFabricSDK.psm1"

$IsUpgrade = ($publishProfile.UpgradeDeployment -and $publishProfile.UpgradeDeployment.Enabled -and $OverrideUpgradeBehavior -ne 'VetoUpgrade') -or $OverrideUpgradeBehavior -eq 'ForceUpgrade'

$PublishParameters = @{
    'ApplicationPackagePath' = $ApplicationPackagePath
    'ApplicationParameterFilePath' = $publishProfile.ApplicationParameterFile
    'ApplicationParameter' = $ApplicationParameter
    'ErrorAction' = 'Stop'
}

if ($publishProfile.CopyPackageParameters.CopyPackageTimeoutSec)
{
    $PublishParameters['CopyPackageTimeoutSec'] = $publishProfile.CopyPackageParameters.CopyPackageTimeoutSec
}

if ($publishProfile.CopyPackageParameters.CompressPackage)
{
    $PublishParameters['CompressPackage'] = $publishProfile.CopyPackageParameters.CompressPackage
}

if ($publishProfile.RegisterApplicationParameters.RegisterApplicationTypeTimeoutSec)
{
    $PublishParameters['RegisterApplicationTypeTimeoutSec'] = $publishProfile.RegisterApplicationParameters.RegisterApplicationTypeTimeoutSec
}

# CopyPackageTimeoutSec parameter overrides the value from the publish profile
if ($CopyPackageTimeoutSec)
{
    $PublishParameters['CopyPackageTimeoutSec'] = $CopyPackageTimeoutSec
}

# RegisterApplicationTypeTimeoutSec parameter overrides the value from the publish profile
if ($RegisterApplicationTypeTimeoutSec)
{
    $PublishParameters['RegisterApplicationTypeTimeoutSec'] = $RegisterApplicationTypeTimeoutSec
}

if ($IsUpgrade)
{
    if ($StartupServicesFile)
    {
        $PublishParameters['StartupServicesFileMode'] = $true
    }

    $Action = "RegisterAndUpgrade"
    if ($DeployOnly)
    {
        $Action = "Register"
    }

    $UpgradeParameters = $publishProfile.UpgradeDeployment.Parameters

    if ($OverrideUpgradeBehavior -eq 'ForceUpgrade')
    {
        # Warning: Do not alter these upgrade parameters. It will create an inconsistency with Visual Studio's behavior.
        $UpgradeParameters = @{ UnmonitoredAuto = $true; Force = $true }
    }

    $PublishParameters['Action'] = $Action
    $PublishParameters['UpgradeParameters'] = $UpgradeParameters
    $PublishParameters['UnregisterUnusedVersions'] = $UnregisterUnusedApplicationVersionsAfterUpgrade

    Publish-UpgradedServiceFabricApplication @PublishParameters
}
else
{
    # Pass the path to the Startup Services File if it was provided
    if ($StartupServicesFile)
    {
        $PublishParameters['StartupServicesFilePath'] = $StartupServicesFile

        if (-not [string]::IsNullOrEmpty($publishProfile.StartupServiceParameterFile))
        {
            $PublishParameters['StartupServiceParameterFilePath'] = $publishProfile.StartupServiceParameterFile
        }
    }

    $Action = "RegisterAndCreate"
    if ($DeployOnly)
    {
        $Action = "Register"
    }

    $PublishParameters['Action'] = $Action
    $PublishParameters['OverwriteBehavior'] = $OverwriteBehavior
    $PublishParameters['SkipPackageValidation'] = $SkipPackageValidation

    Publish-NewServiceFabricApplication @PublishParameters
}
`;var xo=["Cloud","Local.1Node","Local.5Node"];function vt(e){let t=e.serviceTypeName??`${e.serviceName}Type`,r=e.kind??"stateless",n=e.runtime??"netcore";return{...e,serviceTypeName:t,serviceVersion:e.serviceVersion??"1.0.0",applicationVersion:e.applicationVersion??"1.0.0",instanceCountParameter:Qc(r,e.serviceName),kind:r,runtime:n}}function Qc(e,t){return xe(e)?`${t}_TargetReplicaSetSize`:`${t}_InstanceCount`}function ko(e){return`<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="14.0" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <Import Project="..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.props" Condition="Exists('..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.props')" />
  <PropertyGroup Label="Globals">
    <ProjectGuid>{${e.projectGuid.toUpperCase()}}</ProjectGuid>
    <ProjectVersion>2.6</ProjectVersion>
    <MinToolsVersion>16.10</MinToolsVersion>
    <SupportedMSBuildNuGetPackageVersion>1.7.9</SupportedMSBuildNuGetPackageVersion>
  </PropertyGroup>
  <PropertyGroup>
    <Configuration Condition=" '$(Configuration)' == '' ">Debug</Configuration>
    <Platform Condition=" '$(Platform)' == '' ">x64</Platform>
    <ApplicationPackageRootFolder>ApplicationPackageRoot</ApplicationPackageRootFolder>
    <TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion>
    <OutputPath>bin\\$(Configuration)</OutputPath>
    <PackageLocation>pkg\\$(Configuration)\\$(MSBuildProjectName)</PackageLocation>
  </PropertyGroup>
  <ItemGroup Label="ProjectConfigurations">
    <ProjectConfiguration Include="Debug|x64">
      <Configuration>Debug</Configuration>
      <Platform>x64</Platform>
    </ProjectConfiguration>
    <ProjectConfiguration Include="Release|x64">
      <Configuration>Release</Configuration>
      <Platform>x64</Platform>
    </ProjectConfiguration>
  </ItemGroup>
  <ItemGroup>
    <None Include="ApplicationPackageRoot\\ApplicationManifest.xml" />
    <None Include="ApplicationParameters\\Cloud.xml" />
    <None Include="ApplicationParameters\\Local.1Node.xml" />
    <None Include="ApplicationParameters\\Local.5Node.xml" />
    <None Include="PublishProfiles\\Cloud.xml" />
    <None Include="PublishProfiles\\Local.1Node.xml" />
    <None Include="PublishProfiles\\Local.5Node.xml" />
    <None Include="Scripts\\Deploy-FabricApplication.ps1" />
    <None Include="StartupServiceParameters\\Cloud.xml" />
    <None Include="StartupServiceParameters\\Local.1Node.xml" />
    <None Include="StartupServiceParameters\\Local.5Node.xml" />
    <None Include="StartupServices.xml" />
  </ItemGroup>
  <ItemGroup>
    <Content Include="packages.config" />
  </ItemGroup>
  <Import Project="$(MSBuildToolsPath)\\Microsoft.Common.targets" />
  <Target Name="ValidateMSBuildFiles" BeforeTargets="PrepareForBuild">
    <Error Condition="!Exists('..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.props')" Text="Microsoft.VisualStudio.Azure.Fabric.MSBuild not restored. Run 'Service Fabric: Restore NuGet Packages' from the Command Palette, or 'nuget restore &lt;App&gt;.sfproj -PackagesDirectory packages' from a terminal." />
    <Error Condition="!Exists('..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.targets')" Text="Microsoft.VisualStudio.Azure.Fabric.MSBuild not restored. Run 'Service Fabric: Restore NuGet Packages' from the Command Palette, or 'nuget restore &lt;App&gt;.sfproj -PackagesDirectory packages' from a terminal." />
  </Target>
  <PropertyGroup>
    <ApplicationProjectTargetsPath>$(MSBuildExtensionsPath32)\\Microsoft\\VisualStudio\\v$(VisualStudioVersion)\\Service Fabric Tools\\Microsoft.VisualStudio.Azure.Fabric.ApplicationProject.targets</ApplicationProjectTargetsPath>
  </PropertyGroup>
  <Import Project="$(ApplicationProjectTargetsPath)" Condition="Exists('$(ApplicationProjectTargetsPath)')" />
  <Import Project="..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.targets" Condition="Exists('..\\packages\\Microsoft.VisualStudio.Azure.Fabric.MSBuild.1.7.9\\build\\Microsoft.VisualStudio.Azure.Fabric.Application.targets')" />
</Project>
`}function No(){return`<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Microsoft.VisualStudio.Azure.Fabric.MSBuild" version="1.7.9" targetFramework="net472" />
</packages>
`}function $o(e){let t=vt(e),r=F(t.kind)?`
    <Parameter Name="${t.serviceName}_ASPNETCORE_ENVIRONMENT" DefaultValue="" />
  `:"",n;return t.kind==="actor"?n="":F(t.kind)?n=`
    <ConfigOverrides />
    <EnvironmentOverrides CodePackageRef="code">
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value="[${t.serviceName}_ASPNETCORE_ENVIRONMENT]" />
    </EnvironmentOverrides>
  `:n=`
    <ConfigOverrides />
  `,`<?xml version="1.0" encoding="utf-8"?>
<ApplicationManifest xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                     ApplicationTypeName="${t.applicationName}Type"
                     ApplicationTypeVersion="${t.applicationVersion}"
                     xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters>${r}</Parameters>
  <ServiceManifestImport>
    <ServiceManifestRef ServiceManifestName="${t.serviceName}Pkg" ServiceManifestVersion="${t.serviceVersion}" />${n}</ServiceManifestImport>
</ApplicationManifest>
`}function el(e){return xe(e.kind)?`    <Service Name="${e.serviceName}" ServicePackageActivationMode="ExclusiveProcess">
      <StatefulService ServiceTypeName="${e.serviceTypeName}" TargetReplicaSetSize="[${e.serviceName}_TargetReplicaSetSize]" MinReplicaSetSize="[${e.serviceName}_MinReplicaSetSize]">
        <UniformInt64Partition PartitionCount="[${e.serviceName}_PartitionCount]" LowKey="-9223372036854775808" HighKey="9223372036854775807" />
      </StatefulService>
    </Service>`:`    <Service Name="${e.serviceName}" ServicePackageActivationMode="ExclusiveProcess">
      <StatelessService ServiceTypeName="${e.serviceTypeName}" InstanceCount="[${e.instanceCountParameter}]">
        <SingletonPartition />
      </StatelessService>
    </Service>`}function Ao(e){let t=vt(e);if(t.kind==="actor")return`<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${t.serviceName}Pkg"
                 Version="${t.serviceVersion}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <!-- The content will be generated during build -->
</ServiceManifest>
`;let r=xe(t.kind)?`    <StatefulServiceType ServiceTypeName="${t.serviceTypeName}" HasPersistedState="true" />`:`    <StatelessServiceType ServiceTypeName="${t.serviceTypeName}" />`,n=F(t.kind)?`
    <EnvironmentVariables>
      <EnvironmentVariable Name="ASPNETCORE_ENVIRONMENT" Value=""/>
    </EnvironmentVariables>`:"",i=F(t.kind)?`
        <WorkingFolder>CodePackage</WorkingFolder>`:"",o;return t.kind==="aspNetStateful"?o="":t.kind==="aspNetStateless"?o=`
  <Resources>
    <Endpoints>
      <Endpoint Protocol="http" Name="ServiceEndpoint" Type="Input" Port="8559" />
    </Endpoints>
  </Resources>`:t.kind==="stateful"?o=`
  <Resources>
    <Endpoints>
      <Endpoint Name="ServiceEndpoint" />
      <Endpoint Name="ReplicatorEndpoint" />
    </Endpoints>
  </Resources>`:o=`
  <Resources>
    <Endpoints>
      <Endpoint Name="ServiceEndpoint" />
    </Endpoints>
  </Resources>`,`<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="${t.serviceName}Pkg"
                 Version="${t.serviceVersion}"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ServiceTypes>
${r}
  </ServiceTypes>
  <CodePackage Name="Code" Version="${t.serviceVersion}">
    <EntryPoint>
      <ExeHost>
        <Program>${t.serviceName}.exe</Program>${i}
      </ExeHost>
    </EntryPoint>${n}
  </CodePackage>
  <ConfigPackage Name="Config" Version="${t.serviceVersion}" />${o}
</ServiceManifest>
`}function To(){return`<?xml version="1.0" encoding="utf-8"?>
<Settings xmlns="http://schemas.microsoft.com/2011/01/fabric"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
</Settings>
`}function Eo(e){return e==="Cloud"?`<?xml version="1.0" encoding="utf-8"?>
<PublishProfile xmlns="http://schemas.microsoft.com/2015/05/fabrictools">
  <!--
    Replace the connection endpoint and certificate fields below with the values
    for your remote cluster. See https://aka.ms/sfpublishprofile for the full
    reference.
  -->
  <ClusterConnectionParameters ConnectionEndpoint=""
                               X509Credential="true"
                               ServerCertThumbprint=""
                               FindType="FindByThumbprint"
                               FindValue=""
                               StoreLocation="CurrentUser"
                               StoreName="My" />
  <ApplicationParameterFile Path="..\\ApplicationParameters\\Cloud.xml" />
  <StartupServiceParameterFile Path="..\\StartupServiceParameters\\Cloud.xml" />
  <UpgradeDeployment Mode="UnmonitoredAuto" Enabled="false">
    <Parameters UpgradeReplicaSetCheckTimeoutSec="1" Force="true" />
  </UpgradeDeployment>
</PublishProfile>
`:`<?xml version="1.0" encoding="utf-8"?>
<PublishProfile xmlns="http://schemas.microsoft.com/2015/05/fabrictools">
  <ClusterConnectionParameters />
  <ApplicationParameterFile Path="..\\ApplicationParameters\\${e}.xml" />
  <StartupServiceParameterFile Path="..\\StartupServiceParameters\\${e}.xml" />
</PublishProfile>
`}function Ur(e,t="stateless"){return xe(t)?e==="Local.1Node"?"1":"3":e==="Local.1Node"?"1":e==="Local.5Node"?"3":"-1"}function Ro(e,t){let r=vt(e),n=F(r.kind)?`    <Parameter Name="${r.serviceName}_ASPNETCORE_ENVIRONMENT" Value="${t==="Cloud"?"":"Development"}" />`:"",i=n?`
${n}
  `:"";return`<?xml version="1.0" encoding="utf-8"?>
<Application Name="fabric:/${r.applicationName}"
             xmlns="http://schemas.microsoft.com/2011/01/fabric"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Parameters>${i}</Parameters>
</Application>
`}function Fo(e){let t=vt(e);return t.kind==="actor"?`<?xml version="1.0" encoding="utf-8"?>
<StartupServicesManifest xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                         xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters />
  <Services />
</StartupServicesManifest>
`:`<?xml version="1.0" encoding="utf-8"?>
<StartupServicesManifest xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                         xmlns="http://schemas.microsoft.com/2011/01/fabric">
  <Parameters>
${xe(t.kind)?`    <Parameter Name="${t.serviceName}_TargetReplicaSetSize" DefaultValue="3" />
    <Parameter Name="${t.serviceName}_MinReplicaSetSize" DefaultValue="3" />
    <Parameter Name="${t.serviceName}_PartitionCount" DefaultValue="1" />`:`    <Parameter Name="${t.instanceCountParameter}" DefaultValue="-1" />`}
  </Parameters>
  <Services>
${el(t)}
  </Services>
</StartupServicesManifest>
`}function Mo(e,t){let r=vt(e);return r.kind==="actor"?`<?xml version="1.0" encoding="utf-8"?>
<StartupServices xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Parameters />
</StartupServices>
`:`<?xml version="1.0" encoding="utf-8"?>
<StartupServices xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Parameters>
${xe(r.kind)?`    <Parameter Name="${r.serviceName}_TargetReplicaSetSize" Value="${Ur(t,r.kind)}" />
    <Parameter Name="${r.serviceName}_MinReplicaSetSize" Value="${Ur(t,r.kind)}" />
    <Parameter Name="${r.serviceName}_PartitionCount" Value="1" />`:`    <Parameter Name="${r.instanceCountParameter}" Value="${Ur(t,r.kind)}" />`}
  </Parameters>
</StartupServices>
`}function Io(){return Co}function jo(){let e=globalThis.crypto;if(e&&typeof e.randomUUID=="function")return e.randomUUID().toUpperCase();let t=new Uint8Array(16);for(let n=0;n<t.length;n++)t[n]=Math.floor(Math.random()*256);t[6]=t[6]&15|64,t[8]=t[8]&63|128;let r=Array.from(t,n=>n.toString(16).padStart(2,"0")).join("");return(r.slice(0,8)+"-"+r.slice(8,12)+"-"+r.slice(12,16)+"-"+r.slice(16,20)+"-"+r.slice(20)).toUpperCase()}function Lo(e){if(T.existsSync(e.targetDirectory))throw new Error(`Folder already exists: ${e.targetDirectory}`);if(!e.applicationName||!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(e.applicationName))throw new Error(`Invalid application name: '${e.applicationName}'.`);if(!e.serviceName||!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(e.serviceName))throw new Error(`Invalid service name: '${e.serviceName}'.`);if(!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(e.projectGuid))throw new Error(`Invalid project GUID: '${e.projectGuid}'.`);let t=e.targetDirectory,r=E.join(t,"ApplicationPackageRoot"),n=E.join(t,"ApplicationParameters"),i=E.join(t,"PublishProfiles"),o=E.join(t,"StartupServiceParameters"),s=E.join(t,"Scripts"),a=e.kind??"stateless",c=ue(a),l=E.dirname(t),u={serviceName:e.serviceName,serviceTypeName:e.serviceTypeName??`${e.serviceName}Type`,kind:a,runtime:e.runtime??"netcore",version:e.serviceVersion??"1.0.0",targetFramework:e.targetFramework},p=c?ke(u):void 0,d=c&&p?E.join(l,p.csprojDirName):void 0,f=c&&d?E.join(d,"PackageRoot"):E.join(r,`${e.serviceName}Pkg`);if(c&&d&&T.existsSync(d))throw new Error(`Cannot scaffold C# project: directory already exists: ${d}`);T.mkdirSync(r,{recursive:!0}),c?T.mkdirSync(E.join(f,"Config"),{recursive:!0}):(T.mkdirSync(E.join(f,"Code"),{recursive:!0}),T.mkdirSync(E.join(f,"Config"),{recursive:!0})),T.mkdirSync(n,{recursive:!0}),T.mkdirSync(i,{recursive:!0}),T.mkdirSync(o,{recursive:!0}),T.mkdirSync(s,{recursive:!0});let m=E.join(t,`${e.applicationName}.sfproj`);T.writeFileSync(m,ko(e),"utf8");let v=E.join(t,"packages.config");T.writeFileSync(v,No(),"utf8");let h=E.join(r,"ApplicationManifest.xml");T.writeFileSync(h,$o(e),"utf8");let P=E.join(f,"ServiceManifest.xml");T.writeFileSync(P,Ao(e),"utf8");let g=E.join(f,"Config","Settings.xml");T.writeFileSync(g,To(),"utf8");let w=[],b=[],S=[];for(let Z of xo)w.push(_r(i,Z,Eo(Z))),b.push(_r(n,Z,Ro(e,Z))),S.push(_r(o,Z,Mo(e,Z)));let z=E.join(t,"StartupServices.xml");T.writeFileSync(z,Fo(e),"utf8");let O=E.join(s,"Deploy-FabricApplication.ps1");T.writeFileSync(O,Io(),"utf8");let j,le,se;if(c&&d&&p){let Z=tl(u,p,d,m);j=Z.csprojPath,le=Z.launchSettingsPath,se=Z.appsettingsDevelopmentPath}return{sfprojPath:m,applicationManifestPath:h,serviceManifestPath:P,settingsXmlPath:g,publishProfilePaths:w,applicationParameterPaths:b,startupServiceParameterPaths:S,startupServicesPath:z,deployScriptPath:O,packagesConfigPath:v,csprojPath:j,launchSettingsPath:le,appsettingsDevelopmentPath:se}}function tl(e,t,r,n){T.mkdirSync(r,{recursive:!0});let i=E.join(r,`${t.csprojDirName}.csproj`);if(T.writeFileSync(i,zt(e,void 0,t),"utf8"),T.writeFileSync(E.join(r,"Program.cs"),Ut(e,t),"utf8"),e.kind==="actor"){let f=`${r}.Interfaces`;T.mkdirSync(f,{recursive:!0}),T.writeFileSync(E.join(f,`${t.csprojDirName}.Interfaces.csproj`),Xt(e,t),"utf8"),T.writeFileSync(E.join(f,`${t.actorInterfaceName}.cs`),Bt(e,t),"utf8"),T.writeFileSync(E.join(r,`${t.actorTypeName}.cs`),Gt(e,t),"utf8")}else T.writeFileSync(E.join(r,`${t.className}.cs`),_t(e,t),"utf8");let o;if(F(e.kind)){let f=E.join(r,"Controllers");T.mkdirSync(f,{recursive:!0}),T.writeFileSync(E.join(f,"ValuesController.cs"),Wt(e,t),"utf8"),T.writeFileSync(E.join(r,"appsettings.json"),Ht(),"utf8"),o=E.join(r,"appsettings.Development.json"),T.writeFileSync(o,Kt(),"utf8")}let s=E.join(r,"Properties");T.mkdirSync(s,{recursive:!0});let a=E.join(s,"launchSettings.json"),c=e.endpointPort??(F(e.kind)?8559:void 0);T.writeFileSync(a,c!==void 0?it(e,c):it(e),"utf8");let l=E.dirname(n),u=rl(l,i),p=T.readFileSync(n,"utf8"),d=qt(p,u,{kind:e.kind});return d!==p&&T.writeFileSync(n,d,"utf8"),{csprojPath:i,launchSettingsPath:a,appsettingsDevelopmentPath:o}}function rl(e,t){return E.relative(e,t).split("/").join("\\")}function _r(e,t,r){let n=E.join(e,`${t}.xml`);return T.writeFileSync(n,r,"utf8"),n}var L=y(require("vscode")),Ne=y(require("path")),Do=y(require("fs"));var C=y(require("fs")),N=y(require("path"));async function Br(e,t,r){if(!e.applicationManifest)throw new Error("Application manifest is missing.");let n=Gr(e);if(n.has(t.serviceName.toLowerCase()))throw new Error(`A service named '${t.serviceName}' already exists in this application.`);if(n.has(`${t.serviceName.toLowerCase()}pkg`))throw new Error(`A service package '${t.serviceName}Pkg' already exists.`);if(t.kind==="guest"&&!r?.guestSourcePath)throw new Error("Guest executable scaffold requires options.guestSourcePath.");let i=N.dirname(e.sfproj.path),o=N.join(i,e.sfproj.applicationPackageRootFolder),s=N.dirname(i),a=ue(t.kind),c=a?ke(t):void 0,l=a&&c?N.join(s,c.csprojDirName):void 0,u=a&&l?N.join(l,"PackageRoot"):N.join(o,`${t.serviceName}Pkg`);if(a&&l&&C.existsSync(l))throw new Error(`Cannot scaffold C# project: directory already exists: ${l}`);if(!a&&C.existsSync(u))throw new Error(`Service folder already exists on disk: ${u}`);let p=t;if(t.kind==="guest"&&r?.guestSourcePath){let j=r.guestSourcePath,se=C.statSync(j).isDirectory()?t.exeProgram??`${t.serviceName}.exe`:N.basename(j);p={...t,exeProgram:se}}C.mkdirSync(N.join(u,"Config"),{recursive:!0}),a||C.mkdirSync(N.join(u,"Code"),{recursive:!0});let d=N.join(u,"ServiceManifest.xml");C.writeFileSync(d,ho(p),"utf8"),C.writeFileSync(N.join(u,"Config","Settings.xml"),vo(),"utf8");let f;p.kind==="guest"&&r?.guestSourcePath&&(f=ol(r.guestSourcePath,N.join(u,"Code")));let m=e.applicationManifest.path,v=C.readFileSync(m,"utf8"),h=!!e.startupServicesManifest,P=h?Dr(v,p):yo(v,p);C.writeFileSync(m,P,"utf8");let g;if(h&&e.startupServicesManifest){g=e.startupServicesManifest;let j=C.readFileSync(g,"utf8"),le=wo(j,p);le!==j&&C.writeFileSync(g,le,"utf8")}let w=[];for(let j of e.applicationParameters)try{let le=Vr(N.basename(j)),se=C.readFileSync(j,"utf8"),Z=Po(se,p,le);Z!==se&&(C.writeFileSync(j,Z,"utf8"),w.push(j))}catch{}let b=[];if(h)for(let j of e.startupServiceParameters)try{let le=Vr(N.basename(j)),se=C.readFileSync(j,"utf8"),Z=So(se,p,le);Z!==se&&(C.writeFileSync(j,Z,"utf8"),b.push(j))}catch{}let S,z,O;if(a&&l&&c){let j=nl(e,p,l,c);S=j.csprojPath,z=j.launchSettingsPath,O=j.appsettingsDevelopmentPath}return{serviceManifestPath:d,applicationManifestPath:m,patchedParameterFiles:w,patchedStartupParameterFiles:b,startupServicesManifestPath:g,csprojPath:S,launchSettingsPath:z,appsettingsDevelopmentPath:O,guestExePath:f}}function Gr(e){let t=new Set;for(let r of e.serviceManifests)t.add(r.name.toLowerCase()),t.add(r.name.replace(/Pkg$/i,"").toLowerCase());for(let r of e.applicationManifest?.serviceManifestRefs??[])t.add(r.name.toLowerCase()),t.add(r.name.replace(/Pkg$/i,"").toLowerCase());return t}function nl(e,t,r,n){let i=e.sfproj.path,o=N.dirname(i),s=N.dirname(o);C.mkdirSync(r,{recursive:!0});let a=N.join(r,`${n.csprojDirName}.csproj`);if(C.writeFileSync(a,zt(t,void 0,n),"utf8"),C.writeFileSync(N.join(r,"Program.cs"),Ut(t,n),"utf8"),t.kind==="actor"){let h=`${r}.Interfaces`;C.mkdirSync(h,{recursive:!0}),C.writeFileSync(N.join(h,`${n.csprojDirName}.Interfaces.csproj`),Xt(t,n),"utf8"),C.writeFileSync(N.join(h,`${n.actorInterfaceName}.cs`),Bt(t,n),"utf8"),C.writeFileSync(N.join(r,`${n.actorTypeName}.cs`),Gt(t,n),"utf8")}else C.writeFileSync(N.join(r,`${n.className}.cs`),_t(t,n),"utf8");let c;if(F(t.kind)){let h=N.join(r,"Controllers");C.mkdirSync(h,{recursive:!0}),C.writeFileSync(N.join(h,"ValuesController.cs"),Wt(t,n),"utf8"),C.writeFileSync(N.join(r,"appsettings.json"),Ht(),"utf8"),c=N.join(r,"appsettings.Development.json"),C.writeFileSync(c,Kt(),"utf8")}let l=N.join(r,"Properties");C.mkdirSync(l,{recursive:!0});let u=N.join(l,"launchSettings.json"),p=t.endpointPort??(F(t.kind)?8559:void 0),d=F(t.kind)&&t.httpsEndpoint?t.httpsEndpoint.port??8443:void 0;C.writeFileSync(u,p!==void 0?it(t,{http:p,https:d}):it(t),"utf8");let f=il(o,a),m=C.readFileSync(i,"utf8"),v=qt(m,f,{kind:t.kind});return v!==m&&C.writeFileSync(i,v,"utf8"),{csprojPath:a,launchSettingsPath:u,appsettingsDevelopmentPath:c}}function il(e,t){return N.relative(e,t).replace(/\//g,"\\")}function ol(e,t){if(C.statSync(e).isDirectory())return Oo(e,t),sl(t,".exe")??N.join(t,N.basename(e));let n=N.join(t,N.basename(e));return C.copyFileSync(e,n),n}function Oo(e,t){C.mkdirSync(t,{recursive:!0});for(let r of C.readdirSync(e,{withFileTypes:!0})){let n=N.join(e,r.name),i=N.join(t,r.name);r.isDirectory()?Oo(n,i):r.isFile()&&C.copyFileSync(n,i)}}function sl(e,t){for(let r of C.readdirSync(e,{withFileTypes:!0}))if(r.isFile()&&r.name.toLowerCase().endsWith(t.toLowerCase()))return N.join(e,r.name)}async function Vo(e,t,r){let n=e.getProjects();if(n.length===0){L.window.showErrorMessage("No Service Fabric application projects (.sfproj) are open. Add Service requires an existing project.");return}let i=await al(n,r);if(!i)return;if(!i.applicationManifest){L.window.showErrorMessage(`Cannot add a service: ${Ne.basename(i.sfproj.path)} has no readable ApplicationManifest.xml.`);return}let o=await Hr();if(!o)return;let{kind:s,runtime:a}=o,c=Gr(i),l=await cl(i,c);if(!l)return;let u=await L.window.showInputBox({prompt:"Service type name",value:`${l}Type`,validateInput:m=>/^[A-Za-z][A-Za-z0-9_.-]*$/.test(m)?null:"Use letters, digits, dot, dash or underscore."});if(!u)return;let p=await L.window.showInputBox({prompt:"Initial package version",value:"1.0.0",validateInput:m=>/^\d+\.\d+\.\d+(\.\d+)?$/.test(m)?null:"Use a valid version like 1.0.0."});if(!p)return;let d={serviceName:l,serviceTypeName:u,kind:s,runtime:a,version:p},f;if(s==="guest"){if(f=await ll(),!f)return;let m=await L.window.showInputBox({prompt:"Optional command-line arguments for the guest executable (leave blank for none)",value:""});if(m===void 0)return;m.trim()!==""&&(d={...d,guestArguments:m.trim()})}else if(ue(s)){let m=F(s)||a==="netcore"?[{label:"net10.0",description:"Recommended (current LTS, until Nov 2028)",value:"net10.0"},{label:"net9.0",description:"STS \u2014 reaches end-of-support May 12, 2026",value:"net9.0"},{label:"net8.0",description:"LTS (until Nov 2026)",value:"net8.0"}]:[{label:"net472",description:".NET Framework 4.7.2 (classic Service Fabric SDK)",value:"net472"},{label:"net48",description:".NET Framework 4.8",value:"net48"}],v=await L.window.showQuickPick(m,{placeHolder:"Target framework for the generated C# project"});if(!v)return;if(d={...d,targetFramework:v.value},F(s)){let w=await dl();if(w==="cancel")return;if(w){let b=await L.window.showInputBox({prompt:"HTTPS port (Kestrel listen port for the https endpoint)",value:"8443",validateInput:S=>/^[1-9]\d{2,4}$/.test(S)&&+S<=65535?null:"Use a valid TCP port (1\u201365535)."});if(b===void 0)return;d={...d,httpsEndpoint:{port:parseInt(b,10)}}}}let h=Ne.dirname(i.sfproj.path),P=Ne.dirname(h),g=Ne.join(P,l);if(Do.existsSync(g)){L.window.showErrorMessage(`Cannot scaffold the C# project: a folder named '${l}' already exists next to the .sfproj (${g}). Choose a different service name or remove the folder first.`);return}}try{let m=await Br(i,d,{guestSourcePath:f}),v=pl(s,l,i,m.csprojPath,m.guestExePath);if(t.info(v),ue(s)&&L.workspace.getConfiguration("serviceFabric").get("scaffoldAutoRestore",!0))try{let g=await ye(i.sfproj.path,{output:t.outputChannel});g.ok&&g.strategy!=="skipped"?t.info(`Auto-restore succeeded via ${g.strategy}.`):g.ok||t.warn(`Auto-restore failed: ${g.message??"no details"}. Run 'Service Fabric: Restore NuGet Packages' to retry.`)}catch(g){t.warn(`Auto-restore threw: ${g instanceof Error?g.message:String(g)}`)}let h=["Open ServiceManifest.xml","Open ApplicationManifest.xml"];m.csprojPath&&h.unshift("Open generated .csproj");let P=await L.window.showInformationMessage(v,...h);P==="Open ServiceManifest.xml"?await Wr(m.serviceManifestPath):P==="Open ApplicationManifest.xml"?await Wr(i.applicationManifest.path):P==="Open generated .csproj"&&m.csprojPath&&await Wr(m.csprojPath),d.httpsEndpoint&&F(s)&&await ul()}catch(m){let v=m.message;t.error(`Add Service failed: ${v}`),L.window.showErrorMessage(`Add Service failed: ${v}`)}}async function al(e,t){if(t?.resource){let i=t.resource.fsPath.toLowerCase(),o=e.find(s=>s.sfproj.path.toLowerCase()===i);if(o)return o}if(e.length===1)return e[0];let r=e.map(i=>({label:Ne.basename(i.sfproj.path),description:i.applicationManifest?.applicationTypeName,detail:i.sfproj.path,project:i}));return(await L.window.showQuickPick(r,{placeHolder:"Select the Service Fabric application to add a service to"}))?.project}async function Hr(){let e=[{kind:L.QuickPickItemKind.Separator,label:".NET Core"},{label:"Stateless Service",description:"Reliable Stateless service (.NET Core)",detail:"Generates a Reliable Stateless service host + .csproj + ProjectReference.",choice:{kind:"stateless",runtime:"netcore"}},{label:"Stateful Service",description:"Reliable Stateful service with persistent internal state (.NET Core)",detail:"Generates a Reliable Stateful service host that demos a reliable dictionary.",choice:{kind:"stateful",runtime:"netcore"}},{label:"Actor Service",description:"Virtual-actor pattern (.NET Core)",detail:"Generates an actor + actor interface + ActorRuntime registration.",choice:{kind:"actor",runtime:"netcore"}},{label:"Stateless ASP.NET Core",description:"Stateless service hosting an ASP.NET Core pipeline (Kestrel + controllers)",detail:"Generates a stateless service + Controllers/ValuesController.cs + appsettings.json.",choice:{kind:"aspNetStateless",runtime:"netcore"}},{label:"Stateful ASP.NET Core",description:"Stateful service hosting an ASP.NET Core pipeline with reliable collections",detail:"Generates a stateful service + Controllers/ValuesController.cs + appsettings.json.",choice:{kind:"aspNetStateful",runtime:"netcore"}},{kind:L.QuickPickItemKind.Separator,label:".NET Framework"},{label:"Stateless Service",description:"Reliable Stateless service (.NET Framework)",detail:"SDK-style csproj targeting net472.",choice:{kind:"stateless",runtime:"netfx"}},{label:"Stateful Service",description:"Reliable Stateful service (.NET Framework)",detail:"SDK-style csproj targeting net472, demos a reliable dictionary.",choice:{kind:"stateful",runtime:"netfx"}},{label:"Actor Service",description:"Virtual-actor pattern (.NET Framework)",detail:"SDK-style csproj targeting net472 with the ActorRuntime registration.",choice:{kind:"actor",runtime:"netfx"}},{kind:L.QuickPickItemKind.Separator,label:"Hosted Containers and Applications"},{label:"Guest Executable",description:"Wraps an existing binary as a Service Fabric guest exe",detail:"No code generated; copies the supplied binary or folder into Code/.",choice:{kind:"guest",runtime:"netcore"}}];return(await L.window.showQuickPick(e,{placeHolder:"Choose the service kind",matchOnDescription:!0,matchOnDetail:!0}))?.choice}async function cl(e,t){let n=`${(e.applicationManifest?.applicationTypeName??"MyApp").replace(/Type$/,"")}.Service${t.size+1}`;return L.window.showInputBox({prompt:"Service name (also used as the package folder and, for C# kinds, the .csproj name)",value:n,validateInput:i=>/^[A-Za-z][A-Za-z0-9_.-]*$/.test(i)?t.has(i.toLowerCase())?`A service named '${i}' already exists in this application.`:t.has(`${i.toLowerCase()}pkg`)?`A service package '${i}Pkg' already exists.`:null:"Use letters, digits, dot, dash or underscore (must start with a letter)."})}async function ll(){let e=await L.window.showQuickPick([{label:"Pick a single executable",description:"Recommended for self-contained binaries.",value:"file"},{label:"Pick a folder of payload files",description:"Copies the entire folder contents into the service's Code/.",value:"folder"}],{placeHolder:"How should the guest payload be staged?"});return e?(await L.window.showOpenDialog({canSelectFiles:e.value==="file",canSelectFolders:e.value==="folder",canSelectMany:!1,openLabel:e.value==="file"?"Use this executable":"Use this folder",title:e.value==="file"?"Select the guest executable":"Select the payload folder"}))?.[0]?.fsPath:void 0}function pl(e,t,r,n,i){let o=Ne.basename(r.sfproj.path);return e==="guest"?`Added guest service '${t}' to ${o}`+(i?` (staged ${Ne.basename(i)} into Code/)`:"")+".":n?`Added ${e} service '${t}' to ${o}; generated ${Ne.basename(n)} and added a ProjectReference.`:`Added ${e} service '${t}' to ${o}.`}async function Wr(e){let t=await L.workspace.openTextDocument(e);await L.window.showTextDocument(t,{preview:!1})}async function dl(){let e=await L.window.showQuickPick([{label:"No (HTTP only)",description:"Default. Kestrel binds http://+:<port>.",value:"no"},{label:"Yes (HTTP + HTTPS)",description:"Adds a second https endpoint and binds Kestrel to both.",value:"yes"}],{placeHolder:"Generate an HTTPS endpoint in addition to HTTP?",matchOnDescription:!0});if(!e)return"cancel";if(e.value!=="no")return{}}async function ul(){let e=L.workspace.getConfiguration(),t="serviceFabric.scaffold.suppressDevCertPrompt";if(e.get(t,!1))return;let r="Yes",n="No (I will run it later)",i="Don't ask again",o=await L.window.showInformationMessage("The scaffolded service requires the ASP.NET Core HTTPS development certificate to start its HTTPS endpoint. Trust it now?",r,n,i);o===r?await L.commands.executeCommand("serviceFabric.devCert.trust"):o===i&&await e.update(t,!0,L.ConfigurationTarget.Workspace)}async function Uo(e){let t=q.workspace.workspaceFolders;if(!t||t.length===0){q.window.showErrorMessage("Open a folder before creating a Service Fabric application.");return}let r=t.length===1?t[0]:await q.window.showWorkspaceFolderPick({placeHolder:"Select a workspace folder"});if(!r)return;let n=await q.window.showInputBox({prompt:"Application type name",value:"MyApp",validateInput:d=>/^[A-Za-z][A-Za-z0-9_.-]*$/.test(d)?null:"Use letters, digits, dot, dash or underscore."});if(!n)return;let i=await q.window.showInputBox({prompt:"Initial service name",value:`${n}.Service1`,validateInput:d=>/^[A-Za-z][A-Za-z0-9_.-]*$/.test(d)?null:"Use letters, digits, dot, dash or underscore."});if(!i)return;let o=await Hr();if(!o)return;let{kind:s,runtime:a}=o,c;if(ue(s)){let d=F(s)||a==="netcore"?[{label:"net8.0",description:"Recommended (LTS)",value:"net8.0"},{label:"net6.0",description:"LTS",value:"net6.0"}]:[{label:"net472",description:".NET Framework 4.7.2 (classic Service Fabric SDK)",value:"net472"},{label:"net48",description:".NET Framework 4.8",value:"net48"}],f=await q.window.showQuickPick(d,{placeHolder:"Target framework for the seeded service"});if(!f)return;c=f.value}let l=Kr.join(r.uri.fsPath,n);if(zr.existsSync(l)){q.window.showErrorMessage(`Folder already exists: ${l}`);return}if(ue(s)){let d=Kr.join(r.uri.fsPath,i);if(zr.existsSync(d)){q.window.showErrorMessage(`Cannot create the application: a folder named '${i}' already exists next to the new application directory (${d}). Choose a different service name or remove the folder first.`);return}}let u;try{u=Lo({targetDirectory:l,applicationName:n,serviceName:i,projectGuid:jo(),kind:s,runtime:a,targetFramework:c})}catch(d){let f=d instanceof Error?d.message:String(d);e.error(`Create Application failed: ${f}`),q.window.showErrorMessage(`Create Application failed: ${f}`);return}if(e.info(`Scaffolded application at ${l}`),q.workspace.getConfiguration("serviceFabric").get("scaffoldAutoRestore",!0))try{let d=await ye(u.sfprojPath,{output:e.outputChannel});d.ok&&d.strategy!=="skipped"?e.info(`Auto-restore succeeded via ${d.strategy}.`):d.ok||e.warn(`Auto-restore failed: ${d.message??"no details"}. Run 'Service Fabric: Restore NuGet Packages' to retry.`)}catch(d){e.warn(`Auto-restore threw: ${d instanceof Error?d.message:String(d)}`)}let p=await q.window.showInformationMessage(`Created '${n}'.`,"Open .sfproj","Reveal");if(p==="Open .sfproj"){let d=await q.workspace.openTextDocument(u.sfprojPath);await q.window.showTextDocument(d)}else p==="Reveal"&&await q.commands.executeCommand("revealInExplorer",q.Uri.file(l))}var me=y(require("vscode")),ge=y(require("path"));var U=y(require("fs")),ee=y(require("path"));function _o(e,t,r){let n=e,i=!1,o=[];n=n.replace(/\r?\n?\s*<ServiceManifestImport\b[^>]*>[\s\S]*?<\/ServiceManifestImport>/g,l=>new RegExp(`ServiceManifestName="${Me(t)}"`).test(l)?(i=!0,o.push(l),""):l);let s=[];n=n.replace(/\r?\n?\s*<Service\b[^>]*>[\s\S]*?<\/Service>/g,l=>[...r].some(p=>new RegExp(`ServiceTypeName="${Me(p)}"`).test(l))?(s.push(l),""):l);let a=new Set;for(let l of[...s,...o]){let u=l.matchAll(/\[([A-Za-z_][A-Za-z0-9_.-]*)\]/g);for(let p of u)a.add(p[1])}let c=[];for(let l of a){if(new RegExp(`\\[${Me(l)}\\]`).test(n))continue;let p=new RegExp(`\\r?\\n?\\s*<Parameter\\s+Name="${Me(l)}"[^>]*\\/>`,"g"),d=n;n=n.replace(p,""),n!==d&&c.push(l)}return n=n.replace(/<Parameters>\s*<\/Parameters>/g,"<Parameters />"),n=n.replace(/<DefaultServices>\s*<\/DefaultServices>/g,"<DefaultServices />"),{xml:n,removedParameters:c,removedServiceBlocks:s.length,removedImport:i}}function Xr(e,t){if(t.length===0)return e;let r=e;for(let n of t){let i=new RegExp(`\\r?\\n?\\s*<Parameter\\s+Name="${Me(n)}"[^>]*\\/>`,"g");r=r.replace(i,"")}return r=r.replace(/<Parameters>\s*<\/Parameters>/g,"<Parameters />"),r}function Bo(e,t){let r=e,n=[];r=r.replace(/\r?\n?\s*<Service\b[^>]*>[\s\S]*?<\/Service>/g,s=>[...t].some(c=>new RegExp(`ServiceTypeName="${Me(c)}"`).test(s))?(n.push(s),""):s);let i=new Set;for(let s of n){let a=s.matchAll(/\[([A-Za-z_][A-Za-z0-9_.-]*)\]/g);for(let c of a)i.add(c[1])}let o=[];for(let s of i){if(new RegExp(`\\[${Me(s)}\\]`).test(r))continue;let c=new RegExp(`\\r?\\n?\\s*<Parameter\\s+Name="${Me(s)}"[^>]*\\/>`,"g"),l=r;r=r.replace(c,""),r!==l&&o.push(s)}return r=r.replace(/<Parameters>\s*<\/Parameters>/g,"<Parameters />"),r=r.replace(/<Services>\s*<\/Services>/g,"<Services />"),{xml:r,removedParameters:o,removedServiceBlocks:n.length}}function Go(e){let t=new Set,r=/<(?:[A-Za-z]+ServiceType|ServiceType)\s+[^>]*?ServiceTypeName="([^"]+)"/g;for(let n of e.matchAll(r))t.add(n[1]);return[...t]}function Wo(e,t){let r=new Set([t,t.replace(/\//g,"\\"),t.replace(/\\/g,"/")]),n=e,i=!1;for(let o of r){let s=new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${Me(o)}"\\s*\\/>`,"gi"),a=new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${Me(o)}"\\s*>[\\s\\S]*?<\\/ProjectReference>`,"gi"),c=n;n=n.replace(s,"").replace(a,""),n!==c&&(i=!0)}return i?(n=n.replace(/\r?\n?\s*<ItemGroup\b[^>]*>\s*<\/ItemGroup>/g,""),{xml:n,removed:!0}):{xml:e,removed:!1}}function Me(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}async function qr(e,t){if(!e.applicationManifest)throw new Error("Application manifest is missing.");let r=Zr(e,t);if(!r)throw new Error(`No service-manifest package named '${t}' was found in this application.`);let n=[];try{let w=U.readFileSync(r.path,"utf8");n=Go(w)}catch{}let i=new Set(n),o=Zt(e,r.packageDirectory),s=e.applicationManifest.path,a=U.readFileSync(s,"utf8"),c=_o(a,r.name,i);U.writeFileSync(s,c.xml,"utf8");let l,u=new Set;if(e.startupServicesManifest)try{let w=U.readFileSync(e.startupServicesManifest,"utf8"),b=Bo(w,i);b.xml!==w&&(U.writeFileSync(e.startupServicesManifest,b.xml,"utf8"),l=e.startupServicesManifest);for(let S of b.removedParameters)u.add(S)}catch{}let p=[];for(let w of e.applicationParameters)try{let b=U.readFileSync(w,"utf8"),S=Xr(b,c.removedParameters);S!==b&&(U.writeFileSync(w,S,"utf8"),p.push(w))}catch{}let d=u.size>0?[...u]:c.removedParameters,f=[];for(let w of e.startupServiceParameters)try{let b=U.readFileSync(w,"utf8"),S=Xr(b,d);S!==b&&(U.writeFileSync(w,S,"utf8"),f.push(w))}catch{}let m,v,h,P=!1;if(o){let w=ee.dirname(e.sfproj.path),b=ee.relative(w,o.csprojPath).replace(/\//g,"\\");try{let z=U.readFileSync(e.sfproj.path,"utf8"),O=Wo(z,b);O.removed&&(U.writeFileSync(e.sfproj.path,O.xml,"utf8"),P=!0)}catch{}let S=`${o.csprojDirectory}.Interfaces`;if(U.existsSync(S)&&U.statSync(S).isDirectory())try{U.rmSync(S,{recursive:!0,force:!0}),h=S}catch{}try{U.existsSync(o.csprojDirectory)&&(U.rmSync(o.csprojDirectory,{recursive:!0,force:!0}),m=o.csprojPath,v=o.csprojDirectory)}catch{}}let g=r.packageDirectory;return U.existsSync(g)&&U.rmSync(g,{recursive:!0,force:!0}),{packageName:r.name,removedDirectory:g,applicationManifestPath:s,removedParameters:c.removedParameters,removedServiceBlocks:c.removedServiceBlocks,patchedParameterFiles:p,removedCsprojPath:m,removedCsprojDirectory:v,removedActorInterfacesDirectory:h,removedProjectReference:P,patchedStartupServicesManifest:l,patchedStartupParameterFiles:f}}function Zr(e,t){let r=t.toLowerCase(),n=e.serviceManifests.find(o=>o.name.toLowerCase()===r);if(n)return n;let i=r.endsWith("pkg")?r:`${r}pkg`;return e.serviceManifests.find(o=>o.name.toLowerCase()===i)}function Zt(e,t){let r=ee.normalize(t).toLowerCase();for(let n of e.sfproj.projectReferences){if(!U.existsSync(n))continue;let i=ee.dirname(n);if(ee.normalize(ee.join(i,"PackageRoot")).toLowerCase()===r)return{csprojPath:n,csprojDirectory:i};let s;try{s=U.readFileSync(n,"utf8")}catch{continue}if(!/<IsServiceFabricServiceProject>\s*true\s*<\/IsServiceFabricServiceProject>/i.test(s))continue;let a=/<SfPackageRoot>([\s\S]*?)<\/SfPackageRoot>/i.exec(s);if(!a)continue;let c=a[1].replace(/\$\(MSBuildThisFileDirectory\)/gi,i+ee.sep).replace(/\\/g,ee.sep).replace(/\//g,ee.sep).trim(),l=ee.resolve(i,c);if(ee.normalize(l).toLowerCase()===r)return{csprojPath:n,csprojDirectory:i}}}async function Ho(e,t,r){let n=e.getProjects();if(n.length===0){me.window.showErrorMessage("No Service Fabric application projects (.sfproj) are open. Remove Service requires an existing project.");return}let i=await ml(n,r);if(!i)return;if(!i.applicationManifest){me.window.showErrorMessage(`Cannot remove a service: ${ge.basename(i.sfproj.path)} has no readable ApplicationManifest.xml.`);return}if(i.serviceManifests.length===0){me.window.showInformationMessage(`${ge.basename(i.sfproj.path)} has no service packages to remove.`);return}let o=await gl(i);if(!o)return;if(me.workspace.getConfiguration("serviceFabric").get("confirmDestructiveActions")??!0){let c=fl(i,o);if(await me.window.showWarningMessage(`Remove service '${o}' from ${ge.basename(i.sfproj.path)}?`,{modal:!0,detail:c},"Remove")!=="Remove")return}try{let c=await qr(i,o),l=[`Removed '${c.packageName}'`,`${c.removedServiceBlocks} default service block(s)`,`${c.removedParameters.length} parameter(s)`,`${c.patchedParameterFiles.length} parameter file(s) updated`,c.patchedStartupServicesManifest?"StartupServices.xml patched":null,c.patchedStartupParameterFiles.length>0?`${c.patchedStartupParameterFiles.length} StartupServiceParameters file(s) updated`:null,c.removedCsprojPath?`companion project ${ge.basename(c.removedCsprojPath)} deleted`:null,c.removedProjectReference?"ProjectReference stripped from .sfproj":null].filter(Boolean).join("; ");t.info(l);let u=c.removedCsprojPath?`Removed service '${c.packageName}' and companion project ${ge.basename(c.removedCsprojPath)} from ${ge.basename(i.sfproj.path)}.`:`Removed service '${c.packageName}' from ${ge.basename(i.sfproj.path)}.`;if(await me.window.showInformationMessage(u,"Open ApplicationManifest.xml")==="Open ApplicationManifest.xml"){let d=await me.workspace.openTextDocument(c.applicationManifestPath);await me.window.showTextDocument(d,{preview:!1})}}catch(c){let l=c.message;t.error(`Remove Service failed: ${l}`),me.window.showErrorMessage(`Remove Service failed: ${l}`)}}function fl(e,t){let r=Zr(e,t),n=[];if(r){n.push(`Delete: ${r.packageDirectory}`);let i=Zt(e,r.packageDirectory);i&&(n.push(`Delete: ${i.csprojDirectory}`),n.push(`Update: ${ge.basename(e.sfproj.path)} (remove <ProjectReference>)`))}return e.applicationManifest&&n.push(`Update: ${ge.basename(e.applicationManifest.path)}`),e.applicationParameters.length>0&&n.push(`Update: ${e.applicationParameters.length} ApplicationParameters file(s)`),e.startupServicesManifest&&n.push(`Update: ${ge.basename(e.startupServicesManifest)}`),e.startupServiceParameters.length>0&&n.push(`Update: ${e.startupServiceParameters.length} StartupServiceParameters file(s)`),n.push("The change is on disk only \u2014 you may need to redeploy."),n.join(`
`)}async function ml(e,t){if(t?.resource){let i=t.resource.fsPath.toLowerCase(),o=e.find(s=>s.sfproj.path.toLowerCase()===i);if(o)return o}if(e.length===1)return e[0];let r=e.map(i=>({label:ge.basename(i.sfproj.path),description:i.applicationManifest?.applicationTypeName,detail:i.sfproj.path,project:i}));return(await me.window.showQuickPick(r,{placeHolder:"Select the Service Fabric application to remove a service from"}))?.project}async function gl(e){let t=e.serviceManifests.map(n=>{let i=Zt(e,n.packageDirectory);return{label:n.name,description:i?`v${n.version} \xB7 companion: ${ge.basename(i.csprojPath)}`:`v${n.version}`,detail:n.packageDirectory,value:n.name}});return(await me.window.showQuickPick(t,{placeHolder:"Choose a service package to remove"}))?.value}var I=y(require("vscode")),ce=y(require("fs")),A=y(require("path"));function zo(e){return`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>${e.targetFramework}</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
`}function Xo(e){return`namespace ${hl(e)};

public class Class1
{
}
`}function hl(e){return e.split(".").map(t=>t.replace(/[^A-Za-z0-9_]/g,"")).filter(t=>t.length>0).map(t=>/^[0-9]/.test(t)?`_${t}`:t).join(".")||"Library"}function Yr(e,t){let r=t.replace(/\//g,"\\"),n=Zo(t);if(vl(e,n))return{xml:e,changed:!1};let i=`    <ProjectReference Include="${r}" />`,o=/<ItemGroup\b[^>]*>([\s\S]*?)<\/ItemGroup>/g,s,a=null;for(;(s=o.exec(e))!==null;)if(/<ProjectReference\b/.test(s[1])){a={start:s.index,end:s.index+s[0].length};break}if(a){let u=e.slice(a.start,a.end).replace(/(\s*<\/ItemGroup>)/,`
${i}$1`);return{xml:e.slice(0,a.start)+u+e.slice(a.end),changed:!0}}let c=`
  <ItemGroup>
${i}
  </ItemGroup>
`;return/<\/Project>\s*$/.test(e)?{xml:e.replace(/(\s*<\/Project>)/,`${c}$1`),changed:!0}:{xml:e+c,changed:!0}}function qo(e,t){let r=Zo(t),n=e,i=!1;for(let o of r){let s=new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${Ko(o)}"\\s*\\/>`,"gi"),a=new RegExp(`\\r?\\n?\\s*<ProjectReference\\s+Include="${Ko(o)}"\\s*>[\\s\\S]*?<\\/ProjectReference>`,"gi"),c=n;n=n.replace(s,"").replace(a,""),n!==c&&(i=!0)}return i?(n=n.replace(/\r?\n?\s*<ItemGroup\b[^>]*>\s*<\/ItemGroup>/g,""),{xml:n,changed:!0}):{xml:e,changed:!1}}function vl(e,t){let r=/<ProjectReference\s+Include="([^"]+)"/gi,n;for(;(n=r.exec(e))!==null;){let i=n[1].toLowerCase();for(let o of t)if(i===o.toLowerCase())return!0}return!1}function Zo(e){return new Set([e,e.replace(/\//g,"\\"),e.replace(/\\/g,"/")])}function Ko(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function $e(e){return/<IsServiceFabricServiceProject>\s*[Tt]rue\s*<\/IsServiceFabricServiceProject>/.test(e)}function Jr(e){let t=/<TargetFramework>([^<]+)<\/TargetFramework>/.exec(e);if(t)return t[1].trim();let r=/<TargetFrameworks>([^<]+)<\/TargetFrameworks>/.exec(e);if(r){let n=r[1].split(/[;,]/)[0]?.trim();return n||void 0}}function Qr(e,t){let r=/^net(\d+)\.(\d+)$/,n=r.exec(e),i=r.exec(t);if(!n||!i)return;let o=parseInt(n[1],10)*1e3+parseInt(n[2],10),s=parseInt(i[1],10)*1e3+parseInt(i[2],10);return o<s?-1:o>s?1:0}var D=y(require("fs")),Ae=y(require("path"));async function en(e){if(!e.name||!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(e.name))throw new Error(`Invalid library name: '${e.name}'.`);if(!e.workspaceRoot||!D.existsSync(e.workspaceRoot))throw new Error(`Workspace root does not exist: '${e.workspaceRoot}'.`);let t=Ae.join(e.workspaceRoot,e.name),r=Ae.join(t,`${e.name}.csproj`),n=Ae.join(t,"Class1.cs");if(D.existsSync(t)){if(D.readdirSync(t).length>0&&!e.allowExistingEmptyFolder)throw new Error(`Cannot create library: folder already exists and is non-empty: ${t}`)}else D.mkdirSync(t,{recursive:!0});let i=!1;try{D.writeFileSync(r,zo({name:e.name,targetFramework:e.targetFramework}),"utf8"),D.writeFileSync(n,Xo(e.name),"utf8"),i=!0;let o=[];for(let s of e.consumers){if(!D.existsSync(s))throw new Error(`Consumer csproj does not exist: ${s}`);let a=D.readFileSync(s,"utf8");$e(a);let c=Ae.dirname(s),l=Jo(c,r),u=Yr(a,l);u.changed&&(D.writeFileSync(s,u.xml,"utf8"),o.push(s))}return{libraryDirectory:t,libraryCsprojPath:r,classStubPath:n,patchedConsumers:o}}catch(o){if(i){try{D.unlinkSync(r)}catch{}try{D.unlinkSync(n)}catch{}}try{D.existsSync(t)&&D.readdirSync(t).length===0&&D.rmdirSync(t)}catch{}throw o}}async function Yo(e){if(!D.existsSync(e.consumerCsproj))throw new Error(`Consumer csproj does not exist: ${e.consumerCsproj}`);if(!D.existsSync(e.targetCsproj))throw new Error(`Target csproj does not exist: ${e.targetCsproj}`);let t=D.readFileSync(e.targetCsproj,"utf8");if($e(t))throw new Error(`Refusing to add a reference to '${Ae.basename(e.targetCsproj)}': it is a Service Fabric service project. Use 'Service Fabric: Add Service\u2026' for service-to-service references.`);let r=Ae.dirname(e.consumerCsproj),n=Jo(r,e.targetCsproj),i=D.readFileSync(e.consumerCsproj,"utf8"),o=Yr(i,n);return o.changed&&D.writeFileSync(e.consumerCsproj,o.xml,"utf8"),{changed:o.changed,relativePath:n}}function Jo(e,t){return Ae.relative(e,t).split("/").join("\\")}async function Qo(e,t,r){let n=yl(r);if((n?A.extname(n.fsPath).toLowerCase():"")===".csproj"&&n){await Sl(e,t,n.fsPath);return}await wl(e,t,n)}function yl(e){if(e)return e instanceof I.Uri?e:e.resource}async function wl(e,t,r){let n=e.getProjects();if(n.length===0){I.window.showErrorMessage("No Service Fabric application projects (.sfproj) are open. Add Library Project requires an existing project.");return}let i=await bl(n,r);if(!i)return;let o=Cl(i);if(!o){I.window.showErrorMessage("Cannot determine workspace root for the new library.");return}let s=kl(i),a=await es(o,i,s,Al(i,o));if(!a)return;let c=s.length>0?Rl(s.map(f=>f.targetFramework).filter(f=>!!f)):void 0,l=await ts(c);if(!l)return;let u=await $l(s);if(u===void 0)return;if(u.length>0){let f=u.filter(m=>{if(!m.targetFramework)return!1;let v=Qr(m.targetFramework,l);return v!==void 0&&v<0});if(f.length>0){let m=f.map(h=>`${A.basename(h.csprojPath,".csproj")} (${h.targetFramework})`).join(", ");if(await I.window.showWarningMessage(`Library targets ${l} but ${m} target a lower TFM. Build will fail with NU1201. Continue anyway?`,{modal:!0},"Continue","Cancel")!=="Continue")return}}let p;try{p=await en({workspaceRoot:o,name:a,targetFramework:l,consumers:u.map(f=>f.csprojPath)})}catch(f){let m=f instanceof Error?f.message:String(f);t.error(`Add Library Project failed: ${m}`),I.window.showErrorMessage(`Add Library Project failed: ${m}`);return}if(t.info(`Created library '${a}' at ${p.libraryDirectory}, referenced from ${p.patchedConsumers.length} consumer(s).`),I.workspace.getConfiguration("serviceFabric").get("scaffoldAutoRestore",!0))try{await ye(i.sfproj.path,{output:t.outputChannel})}catch{}if(await I.window.showInformationMessage(`Library '${a}' created and referenced from ${p.patchedConsumers.length} service(s).`,"Open csproj")==="Open csproj"){let f=await I.workspace.openTextDocument(p.libraryCsprojPath);await I.window.showTextDocument(f,{preview:!1})}}async function Sl(e,t,r){if(!ce.existsSync(r)){I.window.showErrorMessage(`csproj not found: ${r}`);return}let n=await I.window.showQuickPick([{label:"Create new library project\u2026",description:"Scaffold a new class library and reference it from this csproj.",value:"new"},{label:"Reference existing library project\u2026",description:"Add a <ProjectReference> to an existing library csproj in the workspace.",value:"existing"}],{placeHolder:"Add Library Project"});if(!n)return;if(n.value==="existing"){await Pl(r,t);return}let i=xl(r);if(!i){I.window.showErrorMessage("Cannot determine workspace root for the new library.");return}let o=[{csprojPath:r,targetFramework:El(r)}],s=Tl(r,i),a=await es(i,void 0,o,s);if(!a)return;let c=await ts(o[0].targetFramework??void 0);if(!c)return;let l;try{l=await en({workspaceRoot:i,name:a,targetFramework:c,consumers:[r]})}catch(p){let d=p instanceof Error?p.message:String(p);t.error(`Add Library Project failed: ${d}`),I.window.showErrorMessage(`Add Library Project failed: ${d}`);return}if(t.info(`Created library '${a}' at ${l.libraryDirectory}, referenced from ${A.basename(r)}.`),await I.window.showInformationMessage(`Library '${a}' created and referenced from '${A.basename(r)}'.`,"Open csproj")==="Open csproj"){let p=await I.workspace.openTextDocument(l.libraryCsprojPath);await I.window.showTextDocument(p,{preview:!1})}}async function Pl(e,t){let r=await Nl(e);if(r.length===0){I.window.showInformationMessage("No eligible library projects found in the workspace (must be a non-service .csproj that is not already referenced by this project).");return}let n=r.map(o=>({label:A.basename(o,".csproj"),description:o,value:o})),i=await I.window.showQuickPick(n,{placeHolder:"Pick the library project to reference"});if(i)try{(await Yo({consumerCsproj:e,targetCsproj:i.value})).changed?(t.info(`Added <ProjectReference> to ${A.basename(i.value)} from ${A.basename(e)}`),I.window.showInformationMessage(`Reference added: ${A.basename(e)} \u2192 ${A.basename(i.value)}`)):I.window.showInformationMessage(`${A.basename(e)} already references ${A.basename(i.value)}.`)}catch(o){let s=o instanceof Error?o.message:String(o);t.error(`Add Library Project (reference existing) failed: ${s}`),I.window.showErrorMessage(`Add Library Project failed: ${s}`)}}async function bl(e,t){if(t){let i=t.fsPath.toLowerCase(),o=e.find(a=>a.sfproj.path.toLowerCase()===i);if(o)return o;let s=e.find(a=>i.startsWith(a.sfproj.directory.toLowerCase()));if(s)return s}if(e.length===1)return e[0];let r=e.map(i=>({label:A.basename(i.sfproj.path),description:i.applicationManifest?.applicationTypeName,detail:i.sfproj.path,project:i}));return(await I.window.showQuickPick(r,{placeHolder:"Select the Service Fabric application to add a library to"}))?.project}function Cl(e){let t=I.workspace.workspaceFolders;return t&&t.length>0?t.find(n=>e.sfproj.path.toLowerCase().startsWith(n.uri.fsPath.toLowerCase()))?.uri.fsPath??t[0].uri.fsPath:A.dirname(e.sfproj.directory)}function xl(e){let t=I.workspace.workspaceFolders;return t&&t.length>0?t.find(n=>e.toLowerCase().startsWith(n.uri.fsPath.toLowerCase()))?.uri.fsPath??t[0].uri.fsPath:A.dirname(A.dirname(e))}function kl(e){let t=e.sfproj.directory,r=[];for(let n of e.sfproj.projectReferences){let i=A.isAbsolute(n)?n:A.resolve(t,n.replace(/\\/g,A.sep));try{let o=ce.readFileSync(i,"utf8");if(!$e(o))continue;r.push({csprojPath:i,targetFramework:Jr(o)})}catch{}}return r}async function Nl(e){let t=await I.workspace.findFiles("**/*.csproj","**/{node_modules,bin,obj,packages}/**"),r=ce.existsSync(e)?ce.readFileSync(e,"utf8"):"",n=A.dirname(e),i=new Set,o=/<ProjectReference\s+Include="([^"]+)"/gi,s;for(;(s=o.exec(r))!==null;){let c=s[1].replace(/\//g,A.sep).replace(/\\/g,A.sep);i.add(A.resolve(n,c).toLowerCase())}let a=[];for(let c of t){let l=c.fsPath;if(l.toLowerCase()!==e.toLowerCase()&&!i.has(l.toLowerCase()))try{let u=ce.readFileSync(l,"utf8");if($e(u))continue;a.push(l)}catch{}}return a.sort((c,l)=>c.localeCompare(l))}async function es(e,t,r,n){return I.window.showInputBox({prompt:"Library project name (also used as the folder and .csproj filename)",value:n,validateInput:i=>{if(!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(i))return"Use letters, digits, dot, dash or underscore (must start with a letter).";let o=A.join(e,i);if(ce.existsSync(o))try{let s=ce.readdirSync(o);if(s.length>0&&s.some(c=>c.toLowerCase().endsWith(".csproj")))return"A project already exists at this path."}catch{}for(let s of r)if(A.basename(A.dirname(s.csprojPath)).toLowerCase()===i.toLowerCase())return`Name '${i}' collides with an existing service folder.`;return null}})}async function ts(e){let t=["net10.0","net9.0","net8.0"],r=t.map(i=>({label:i,description:i==="net10.0"?"Recommended (current LTS, until Nov 2028)":i==="net9.0"?"STS \u2014 reaches end-of-support May 12, 2026":"LTS (until Nov 2026)",value:i}));if(e&&t.includes(e)){let i=r.findIndex(o=>o.value===e);if(i>0){let[o]=r.splice(i,1);r.unshift(o)}}return(await I.window.showQuickPick(r,{placeHolder:"Target framework for the library project"}))?.value}async function $l(e){if(e.length===0)return await I.window.showInformationMessage("This application has no service C# projects to wire the library into. Scaffold the library anyway?",{modal:!0},"Scaffold without consumers","Cancel")!=="Scaffold without consumers"?void 0:[];let t=e.map(n=>({label:A.basename(n.csprojPath,".csproj"),description:n.targetFramework??"(unknown TFM)",detail:n.csprojPath,consumer:n,picked:!1})),r=await I.window.showQuickPick(t,{placeHolder:"Pick which service csprojs should reference the new library (leave empty to skip wiring)",canPickMany:!0});if(r!==void 0)return r.map(n=>n.consumer)}function Al(e,t){let r=e.applicationManifest?.applicationTypeName?.replace(/Type$/,"")??A.basename(e.sfproj.path,".sfproj"),n=`${r}.Shared`;if(!ce.existsSync(A.join(t,n)))return n;for(let i=2;i<100;i++){let o=`${r}.Shared${i}`;if(!ce.existsSync(A.join(t,o)))return o}return n}function Tl(e,t){let r=A.basename(e,".csproj").replace(/Service$/,"")+".Shared";if(!ce.existsSync(A.join(t,r)))return r;for(let n=2;n<100;n++){let i=`${r}${n}`;if(!ce.existsSync(A.join(t,i)))return i}return r}function El(e){try{return Jr(ce.readFileSync(e,"utf8"))}catch{return}}function Rl(e){let t;for(let r of e){if(!/^net\d+\.\d+$/.test(r))continue;if(t===void 0){t=r;continue}let n=Qr(r,t);n!==void 0&&n<0&&(t=r)}return t}var H=y(require("vscode")),ot=y(require("fs")),B=y(require("path"));var he=y(require("fs")),Te=y(require("path"));async function tn(e){let t=Te.dirname(e.libraryCsprojPath);if(!he.existsSync(e.libraryCsprojPath))throw new Error(`Library csproj does not exist: ${e.libraryCsprojPath}`);let r=he.readFileSync(e.libraryCsprojPath,"utf8");if($e(r))throw new Error(`Refusing to remove '${Te.basename(e.libraryCsprojPath)}': it is a Service Fabric service project. Use 'Service Fabric: Remove Service\u2026' for services.`);let n=[];for(let o of e.consumers){if(!he.existsSync(o))continue;let s=Te.dirname(o),a=he.readFileSync(o,"utf8"),c=Ml(s,e.libraryCsprojPath),l=a,u=!1;for(let p of c){let d=qo(l,p);d.changed&&(l=d.xml,u=!0)}u&&(he.writeFileSync(o,l,"utf8"),n.push(o))}let i=!1;if(e.deleteFolder&&!await Fl(e.libraryCsprojPath,t))try{he.rmSync(t,{recursive:!0,force:!0}),i=!0}catch(s){throw new Error(`Consumers were unwired but the library folder could not be deleted: ${s instanceof Error?s.message:String(s)}`)}return{unwiredConsumers:n,folderDeleted:i,libraryDirectory:t}}async function Fl(e,t){let r=Te.dirname(t),n=Te.basename(e).toLowerCase(),i=[{dir:r,depth:0}];for(;i.length>0;){let{dir:o,depth:s}=i.pop();if(s>4)continue;let a;try{a=he.readdirSync(o,{withFileTypes:!0})}catch{continue}for(let c of a){let l=Te.join(o,c.name);if(c.isDirectory()){if(c.name==="node_modules"||c.name===".git"||c.name==="bin"||c.name==="obj"||c.name==="packages"||l===t)continue;i.push({dir:l,depth:s+1});continue}if(c.isFile()&&c.name.toLowerCase().endsWith(".csproj"))try{let u=he.readFileSync(l,"utf8"),p=/<ProjectReference\s+Include="([^"]+)"/gi,d;for(;(d=p.exec(u))!==null;){let f=d[1].toLowerCase().replace(/\//g,"\\");if(f.endsWith(`\\${n}`)||f===n)return!0}}catch{}}}return!1}function Ml(e,t){let r=Te.relative(e,t),n=r.split("/").join("\\"),i=r.split("\\").join("/");return Array.from(new Set([n,i,r]))}async function rs(e,t,r){let n=Il(r);if((n?B.extname(n.fsPath).toLowerCase():"")===".csproj"&&n){await Ll(t,n.fsPath);return}await jl(e,t,n)}function Il(e){if(e)return e instanceof H.Uri?e:e.resource}async function jl(e,t,r){let n=e.getProjects();if(n.length===0){H.window.showErrorMessage("No Service Fabric application projects (.sfproj) are open.");return}let i=await Ol(n,r);if(!i)return;let o=await Dl(i);if(o.length===0){H.window.showInformationMessage("No library projects found in the workspace (a library is a non-service .csproj that is referenced by at least one service).");return}let s=o.map(d=>({label:B.basename(d.libraryCsprojPath,".csproj"),description:`${d.consumers.length} consumer(s)`,detail:d.libraryCsprojPath,library:d})),a=await H.window.showQuickPick(s,{placeHolder:"Select the library project to remove"});if(!a)return;let c=a.library.consumers.map(d=>({label:B.basename(d,".csproj"),description:d,consumer:d,picked:!0})),l=await H.window.showQuickPick(c,{placeHolder:"Pick which consumers should drop their reference (defaults to all)",canPickMany:!0});if(l===void 0)return;let u=l.length===a.library.consumers.length,p=!1;if(u){let d=await H.window.showWarningMessage(`All consumers will be unwired from '${B.basename(a.library.libraryCsprojPath)}'. Also delete the library folder from disk?`,{modal:!0},"Unwire only","Unwire and delete folder");if(d===void 0)return;p=d==="Unwire and delete folder"}else if(await H.window.showInformationMessage(`Unwire ${l.length} of ${a.library.consumers.length} consumer(s) from '${B.basename(a.library.libraryCsprojPath)}'?`,{modal:!0},"Unwire selected")!=="Unwire selected")return;try{let d=await tn({libraryCsprojPath:a.library.libraryCsprojPath,consumers:l.map(m=>m.consumer),deleteFolder:p});t.info(`Removed library references from ${d.unwiredConsumers.length} consumer(s).`+(d.folderDeleted?` Library folder deleted: ${d.libraryDirectory}`:""));let f=d.folderDeleted?" Folder deleted.":"";H.window.showInformationMessage(`Library '${B.basename(a.library.libraryCsprojPath,".csproj")}' unwired from ${d.unwiredConsumers.length} consumer(s).${f}`)}catch(d){let f=d instanceof Error?d.message:String(d);t.error(`Remove Library Project failed: ${f}`),H.window.showErrorMessage(`Remove Library Project failed: ${f}`)}}async function Ll(e,t){if(!ot.existsSync(t)){H.window.showErrorMessage(`csproj not found: ${t}`);return}let r=ot.readFileSync(t,"utf8");if($e(r)){H.window.showErrorMessage(`'${B.basename(t)}' is a Service Fabric service project. Use 'Service Fabric: Remove Service\u2026' instead.`);return}let n=await Vl(t);if(n.length===0){H.window.showInformationMessage(`No consumers reference '${B.basename(t)}' in the workspace.`);return}let i=n.map(a=>({label:B.basename(a,".csproj"),description:a,consumer:a,picked:!0})),o=await H.window.showQuickPick(i,{placeHolder:`Drop the reference to '${B.basename(t,".csproj")}' from which consumer(s)?`,canPickMany:!0});if(!(o===void 0||o.length===0||await H.window.showWarningMessage(`Unwire ${o.length} consumer(s) from '${B.basename(t)}'?`,{modal:!0},"Unwire")!=="Unwire"))try{let a=await tn({libraryCsprojPath:t,consumers:o.map(c=>c.consumer),deleteFolder:!1});e.info(`Unwired ${a.unwiredConsumers.length} consumer(s) from ${B.basename(t)}.`),H.window.showInformationMessage(`Library '${B.basename(t,".csproj")}' unwired from ${a.unwiredConsumers.length} consumer(s).`)}catch(a){let c=a instanceof Error?a.message:String(a);e.error(`Remove Library Project failed: ${c}`),H.window.showErrorMessage(`Remove Library Project failed: ${c}`)}}async function Ol(e,t){if(t){let i=t.fsPath.toLowerCase(),o=e.find(a=>a.sfproj.path.toLowerCase()===i);if(o)return o;let s=e.find(a=>i.startsWith(a.sfproj.directory.toLowerCase()));if(s)return s}if(e.length===1)return e[0];let r=e.map(i=>({label:B.basename(i.sfproj.path),description:i.applicationManifest?.applicationTypeName,detail:i.sfproj.path,project:i}));return(await H.window.showQuickPick(r,{placeHolder:"Select the Service Fabric application"}))?.project}async function Dl(e){let r=(await H.workspace.findFiles("**/*.csproj","**/{node_modules,bin,obj,packages}/**")).map(i=>i.fsPath),n=[];for(let i of r)try{let o=ot.readFileSync(i,"utf8");if($e(o))continue;let s=[];for(let a of r)a.toLowerCase()!==i.toLowerCase()&&ns(a,i)&&s.push(a);if(s.length===0)continue;n.push({libraryCsprojPath:i,consumers:s})}catch{}return n.sort((i,o)=>i.libraryCsprojPath.localeCompare(o.libraryCsprojPath))}async function Vl(e){let t=await H.workspace.findFiles("**/*.csproj","**/{node_modules,bin,obj,packages}/**"),r=[];for(let n of t)n.fsPath.toLowerCase()!==e.toLowerCase()&&ns(n.fsPath,e)&&r.push(n.fsPath);return r.sort((n,i)=>n.localeCompare(i))}function ns(e,t){let r;try{r=ot.readFileSync(e,"utf8")}catch{return!1}let n=B.dirname(e),i=/<ProjectReference\s+Include="([^"]+)"/gi,o;for(;(o=i.exec(r))!==null;){let s=o[1].replace(/\\/g,B.sep).replace(/\//g,B.sep);if(B.resolve(n,s).toLowerCase()===t.toLowerCase())return!0}return!1}Lr();var yt=y(require("vscode"));ze();var Yt=class{constructor(t,r){this.store=t;this.logger=r}panel;timer;show(t){if(this.panel){this.panel.reveal(yt.ViewColumn.Active);return}let r=yt.window.createWebviewPanel("serviceFabric.diagnosticEvents","Service Fabric: Diagnostic Events",yt.ViewColumn.Active,{enableScripts:!0,retainContextWhenHidden:!0,localResourceRoots:[t]});this.panel=r,r.webview.html=Ul(),r.onDidDispose(()=>{this.panel=void 0,this.timer&&(clearInterval(this.timer),this.timer=void 0)}),r.webview.onDidReceiveMessage(n=>{n?.type==="refresh"&&this.poll()}),this.poll(),this.timer=setInterval(()=>this.poll(),15e3)}async poll(){if(!this.panel)return;let t=this.store.getActive();if(!t?.connected){this.panel.webview.postMessage({type:"state",state:{connected:!1,events:[],message:"No active cluster connection."}});return}let r=new de(t.endpoint),n=new Date(Date.now()-60*60*1e3).toISOString(),i=new Date().toISOString();try{let o=`/EventsStore/Cluster/Events?StartTimeUtc=${encodeURIComponent(n)}&EndTimeUtc=${encodeURIComponent(i)}`,s=await r.rawGet(o,6e3),a=Array.isArray(s)?s.slice().reverse():[];this.panel.webview.postMessage({type:"state",state:{connected:!0,endpoint:t.endpoint,label:t.label,events:a.slice(0,200)}})}catch(o){this.logger.warn(`Diagnostic events poll failed: ${o.message}`),this.panel.webview.postMessage({type:"state",state:{connected:!0,endpoint:t.endpoint,label:t.label,events:[],message:`Failed to fetch /EventsStore. Most local dev clusters do not enable EventStore \u2014 this view is best used with clusters that have EventStore configured. (${o.message})`}})}}dispose(){this.timer&&clearInterval(this.timer),this.panel?.dispose()}};function Ul(){return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Diagnostic Events</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
  header h2 { margin: 0; font-size: 1.05em; }
  header span.endpoint { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  button { padding: 4px 10px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; vertical-align: top; }
  th { position: sticky; top: 0; background: var(--vscode-editor-background); }
  tr:hover { background: var(--vscode-list-hoverBackground); }
  .kind { font-weight: 600; }
  .category-Health { color: var(--vscode-charts-green); }
  .category-StateTransition { color: var(--vscode-charts-blue); }
  .category-Operational { color: var(--vscode-charts-yellow); }
  .meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 32px 0; text-align: center; }
  details { margin-top: 4px; }
  details > summary { cursor: pointer; color: var(--vscode-textLink-foreground); }
  pre { margin: 4px 0; white-space: pre-wrap; word-break: break-all; font-size: 11px; }
</style>
</head>
<body>
<header>
  <h2>Service Fabric Diagnostic Events</h2>
  <span class="endpoint" id="endpoint">disconnected</span>
  <button id="refresh">Refresh</button>
</header>
<div id="content"><div class="empty">Loading\u2026</div></div>
<script>
const vscode = acquireVsCodeApi();
document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type !== 'state') return;
  const s = msg.state;
  document.getElementById('endpoint').textContent = s.connected ? (s.label + ' \u2022 ' + s.endpoint) : 'disconnected';
  const root = document.getElementById('content');
  if (!s.events?.length) {
    root.innerHTML = '<div class="empty">' + (s.message || 'No events in the last hour.') + '</div>';
    return;
  }
  const rows = s.events.map((e) => {
    const kind = escapeHtml(e.Kind || '');
    const cat = escapeHtml(e.Category || '');
    const ts = escapeHtml(e.TimeStamp || '');
    const id = escapeHtml(e.EventInstanceId || '');
    const props = Object.entries(e)
      .filter(([k]) => !['Kind','Category','TimeStamp','EventInstanceId','HasCorrelatedEvents'].includes(k))
      .map(([k,v]) => k + ': ' + escapeHtml(JSON.stringify(v)))
      .join('\\n');
    return '<tr><td><span class="kind">' + kind + '</span><div class="meta">' + id + '</div></td>' +
           '<td><span class="category-' + cat + '">' + cat + '</span></td>' +
           '<td>' + ts + '</td>' +
           '<td><details><summary>details</summary><pre>' + escapeHtml(props) + '</pre></details></td></tr>';
  }).join('');
  root.innerHTML = '<table><thead><tr><th>Kind</th><th>Category</th><th>Timestamp (UTC)</th><th>Properties</th></tr></thead><tbody>' + rows + '</tbody></table>';
});
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
</script>
</body>
</html>`}var Jt=y(require("vscode")),Qt=class{constructor(t){this.logger=t;this.recompute(),this.disposable=Jt.workspace.onDidChangeConfiguration(r=>{(r.affectsConfiguration("telemetry.telemetryLevel")||r.affectsConfiguration("serviceFabric.telemetry.enabled"))&&this.recompute()})}enabled=!1;disposable;recompute(){let t=Jt.workspace.getConfiguration("telemetry").get("telemetryLevel")??"all",r=Jt.workspace.getConfiguration("serviceFabric").get("telemetry.enabled")??!1;this.enabled=r&&t!=="off"}isEnabled(){return this.enabled}event(t,r){if(!this.enabled)return;let n=r?is(r):{};this.logger.debug(`[telemetry] ${t} ${JSON.stringify(n)}`)}error(t,r,n){if(!this.enabled)return;let i={...n??{},error:r instanceof Error?r.name:"unknown"};this.logger.debug(`[telemetry] error:${t} ${JSON.stringify(is(i))}`)}dispose(){this.disposable.dispose()}};function is(e){let t={};for(let[r,n]of Object.entries(e)){if(n===void 0)continue;if(typeof n=="number"||typeof n=="boolean"){t[r]=n;continue}let i=String(n);if(_l(r)){t[r]="<redacted>";continue}Bl(i)?t[r]="http://<redacted>":i.length<=32&&/^[a-zA-Z0-9_.-]+$/.test(i)?t[r]=i:t[r]=`<len:${i.length}>`}return t}function _l(e){return/name|user|host|endpoint|path|app|cluster|node/i.test(e)}function Bl(e){return/^https?:\/\//i.test(e)}async function zl(e){let{logger:t,channel:r}=an();e.subscriptions.push(r);let n=$.workspace.getConfiguration("serviceFabric");t.setLevel(n.get("logLevel")??"info"),t.info(`Service Fabric extension activating on ${process.platform}`);let i=new $t(t);await i.initialize(),e.subscriptions.push(i);let o=new At(i),s=$.window.createTreeView("serviceFabric.applications",{treeDataProvider:o});e.subscriptions.push(s);let a=new Mt(e);e.subscriptions.push(a);let c=new It(a,t),l=new Tt(a),u=$.window.createTreeView("serviceFabric.clusters",{treeDataProvider:l});e.subscriptions.push(u);let p=new jt(a,c,t);e.subscriptions.push(p);let d=new Qt(t);e.subscriptions.push(d),d.event("extension.activated",{platform:process.platform});let f=new Yt(a,t);e.subscriptions.push(f),e.subscriptions.push($.debug.registerDebugConfigurationProvider("servicefabric",new Vt(a)));let m=()=>{$.commands.executeCommand("setContext","serviceFabric.hasProject",i.getProjects().length>0)};m(),e.subscriptions.push(i.onDidChange(m)),await ti(e,t);let v=new Et(i);v.setEnabled(n.get("diagnostics.enableManifestRules")??!0),e.subscriptions.push(v);let h=[{language:"xml",scheme:"file",pattern:"**/ApplicationManifest.xml"},{language:"xml",scheme:"file",pattern:"**/ServiceManifest.xml"}];e.subscriptions.push($.languages.registerDefinitionProvider(h,new Rt(i)),$.languages.registerCodeActionsProvider(h,new ut(i),{providedCodeActionKinds:ut.providedCodeActionKinds})),e.subscriptions.push($.tasks.registerTaskProvider(et.type,new et(i))),e.subscriptions.push($.workspace.onDidChangeConfiguration(g=>{if(g.affectsConfiguration("serviceFabric.logLevel")){let w=$.workspace.getConfiguration("serviceFabric").get("logLevel")??"info";t.setLevel(w)}if(g.affectsConfiguration("serviceFabric.diagnostics.enableManifestRules")){let w=$.workspace.getConfiguration("serviceFabric").get("diagnostics.enableManifestRules")??!0;v.setEnabled(w)}}));let P=[["serviceFabric.refreshApplications",()=>o.refresh()],["serviceFabric.refreshClusters",()=>l.refresh()],["serviceFabric.openFile",async g=>{if(!g)return;let w;try{w=await $.workspace.fs.stat(g)}catch{w=void 0}if(w?.type===$.FileType.Directory)await $.commands.executeCommand("revealInExplorer",g);else{let b=await $.workspace.openTextDocument(g);await $.window.showTextDocument(b,{preview:!1})}}],["serviceFabric.build",g=>ft(i,t,"Build",g)],["serviceFabric.rebuild",g=>ft(i,t,"Rebuild",g)],["serviceFabric.clean",g=>ft(i,t,"Clean",g)],["serviceFabric.package",g=>ft(i,t,"Package",g)],["serviceFabric.restore",async g=>{let w=await Ke(i,g);if(!w)return;let b=await $.window.withProgress({location:$.ProgressLocation.Notification,title:`Service Fabric: restoring NuGet packages for ${w.sfproj.path}\u2026`},S=>ye(w.sfproj.path,{output:t.outputChannel,progress:S}));if(!b.ok){t.error(`NuGet restore failed (${b.strategy}): ${b.message??"no details"}`),await $.window.showErrorMessage(`Service Fabric: NuGet restore failed. ${b.message??""}`,{modal:!0});return}b.strategy==="skipped"?(t.debug("NuGet restore skipped (already up to date)."),$.window.showInformationMessage("Service Fabric: NuGet packages are already restored.")):(t.info(`NuGet restore succeeded via ${b.strategy}.`),$.window.showInformationMessage(`Service Fabric: NuGet packages restored (${b.strategy}).`))}],["serviceFabric.publish",g=>po(i,a,c,t,g,e.workspaceState,d)],["serviceFabric.remove",g=>fo(i,a,c,t,g)],["serviceFabric.cluster.connectLocal",()=>fi(c)],["serviceFabric.cluster.connectRemote",()=>mi(a,c)],["serviceFabric.cluster.disconnect",g=>gi(a,g?.connection)],["serviceFabric.cluster.selectActive",()=>hi(a)],["serviceFabric.cluster.startLocal",()=>vi(t)],["serviceFabric.cluster.stopLocal",()=>yi(t)],["serviceFabric.cluster.resetLocal",()=>Nr(t)],["serviceFabric.cluster.switchLocalMode",()=>wi(t)],["serviceFabric.cluster.openExplorer",g=>Si(a,g?.connection)],["serviceFabric.createApplication",()=>Uo(t)],["serviceFabric.addService",g=>Vo(i,t,er(g))],["serviceFabric.removeService",g=>Ho(i,t,er(g))],["serviceFabric.addLibrary",g=>Qo(i,t,er(g))],["serviceFabric.removeLibrary",g=>rs(i,t,er(g))],["serviceFabric.debug.attachToService",g=>(d.event("debug.attach.invoked"),eo(a,t,g))],["serviceFabric.debug.autoAttachNext",async g=>{let w=g?.appName;if(!w){$.window.showWarningMessage("Right-click an application in the Clusters tree to enable auto-attach for the next deploy.");return}let b=w.startsWith("fabric:/")?w:`fabric:/${w}`,S=`serviceFabric.autoAttachNext:${b}`;await e.workspaceState.update(S,!0),d.event("debug.autoAttachNext.armed"),$.window.showInformationMessage(`Auto-attach armed for ${b}. The next successful Publish will attach the debugger.`)}],["serviceFabric.devCert.trust",async()=>{d.event("devcert.trust.invoked");let{runDevCertTrust:g}=await Promise.resolve().then(()=>(ps(),ls));await g(t,d,"manual")}],["serviceFabric.diagnostics.showEvents",()=>{d.event("diagnostics.events.opened"),f.show(e.extensionUri)}],["serviceFabric.openWalkthrough",()=>$.commands.executeCommand("workbench.action.openWalkthrough",{category:`${e.extension.id}#serviceFabric.gettingStarted`},!1)],["serviceFabric.openHelp",async()=>{d.event("help.opened");let g=$.Uri.joinPath(e.extensionUri,"docs","HOWTO.md");try{await $.commands.executeCommand("markdown.showPreview",g)}catch{let w=await $.workspace.openTextDocument(g);await $.window.showTextDocument(w,{preview:!1})}}],["serviceFabric.resetTier2Prompt",async()=>{let{TIER2_PROMPT_SUPPRESS_KEY_PREFIX:g}=await Promise.resolve().then(()=>(Rr(),Hi)),w=e.workspaceState.keys().filter(S=>S.startsWith(g));for(let S of w)await e.workspaceState.update(S,void 0);let b=w.length===1?"entry":"entries";t.info(`Reset Tier 2 property-evaluator prompt: cleared ${w.length} legacy ${b} from 1.1.10.`),$.window.showInformationMessage(`Service Fabric: Cleared ${w.length} legacy Tier 2 prompt ${b}. (In 1.1.11+ the prompt no longer remembers per-project decisions; this command only clears stale entries from 1.1.10.)`)}]];for(let[g,w]of P)e.subscriptions.push($.commands.registerCommand(g,w));t.info(`Found ${i.getProjects().length} Service Fabric project(s) in this workspace.`),v.refreshAll()}function Xl(){}function er(e){if(e)return e instanceof $.Uri?{resource:e}:e}0&&(module.exports={activate,deactivate});
