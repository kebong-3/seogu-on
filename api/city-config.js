import {safetyStatus} from '../server/city/safetydata.js';
import {gate,send,districtBounds} from '../server/city/common.js';
import {flags} from '../server/city/providers.js';
export default function handler(req,res){if(!gate(req,res))return;send(res,200,{version:'0.15.1',safetySources:safetyStatus(),configured:flags(),bounds:districtBounds,accidentYear:process.env.TAAS_YEAR||'2024',stateMeaning:'설정 여부입니다. 유효 키·서비스 승인·실제 응답·건물 제공범위는 별도 검사합니다.'});}
