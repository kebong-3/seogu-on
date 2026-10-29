#!/usr/bin/env python3
"""Rebuild image-interpreted police reference linework; no API calls or dependencies.

The controls JSON retains 960x720 slide pixels, matched positions and source IDs.
Affine calibration residuals measure agreement of those controls, NOT official
survey accuracy. Native OSM road waypoints are kept separate from image geometry.
Usage: python3 scripts/data/build-safe-return-image-routes.py [controls.json] [output.geojson]
"""
import json, math, sys
from pathlib import Path

R=6378137.0
ALIGNMENT_SOURCE={"name":"OpenStreetMap contributors","url":"https://www.openstreetmap.org/copyright","license":"ODbL 1.0"}
ROOT=Path(__file__).resolve().parents[2]
CONTROL=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).with_name('safe-return-georeference-controls.json')
OUTPUT=Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'public/data/walk/seogu/safe-return-image-routes.geojson'

def project(p):
    return [R*math.radians(p[0]),R*math.log(math.tan(math.pi/4+math.radians(p[1])/2))]
def unproject(p):
    return [round(math.degrees(p[0]/R),7),round(math.degrees(2*math.atan(math.exp(p[1]/R))-math.pi/2),7)]
def solve(a,b):
    m=[list(row)+[v] for row,v in zip(a,b)]
    for i in range(3):
        j=max(range(i,3),key=lambda k:abs(m[k][i]))
        if abs(m[j][i])<1e-12:raise ValueError('Control points are collinear')
        m[i],m[j]=m[j],m[i]
        pivot=m[i][i];m[i]=[v/pivot for v in m[i]]
        for j in range(3):
            if j==i:continue
            factor=m[j][i];m[j]=[v-factor*t for v,t in zip(m[j],m[i])]
    return [row[-1] for row in m]
def fit(controls):
    coords=[project(c['coordinate']) for c in controls]
    origin=[sum(p[k] for p in coords)/len(coords) for k in (0,1)]
    pixels=[[c['pixel'][0]/960,c['pixel'][1]/720,1] for c in controls]
    normal=[[sum(p[i]*p[j] for p in pixels) for j in range(3)] for i in range(3)]
    coeff=[solve(normal,[sum(p[i]*(g[k]-origin[k]) for p,g in zip(pixels,coords)) for i in range(3)]) for k in (0,1)]
    def transform(pixel):
        v=[pixel[0]/960,pixel[1]/720,1]
        return [origin[k]+sum(v[j]*coeff[k][j] for j in range(3)) for k in (0,1)]
    scale=math.cos(math.radians(sum(c['coordinate'][1] for c in controls)/len(controls)))
    errors=[math.dist(transform(c['pixel']),g)*scale for c,g in zip(controls,coords)]
    return transform,errors

data=json.loads(CONTROL.read_text());source=data['source'];features=[];report=[]
for route in data['routes']:
    transform,errors=fit(route['controls']);rmse=math.sqrt(sum(e*e for e in errors)/len(errors))
    # A minimum covers manual image-point reading, symbol offsets and uncontrolled portions.
    uncertainty=max(route['minimumUncertaintyMeters'],int(math.ceil(max(errors)*1.5/5)*5))
    geometry={'type':'MultiLineString','coordinates':[[unproject(transform(p)) for p in line] for line in route['pixelLines']]}
    auxiliary={'type':'MultiLineString','coordinates':[[unproject(transform(p)) for p in line] for line in route.get('auxiliaryPixelLines',[])]}
    props={**source,'id':route['id'],'routeId':route['id'],'name':route['name'],'featureType':'safe-return-reference-route','regionId':'seogu','geometryStatus':'image-interpreted','coordinateAuthority':'image-georeferenced-not-official','sourcePosition':'police-map-red-stroke','sourceSlide':route['slide'],'traceMethod':route['traceMethod'],'sourceSlideSha256':route['sourceSlideSha256'],'controlPointCount':len(route['controls']),'controlResidualRmseMeters':round(rmse,1),'controlResidualMaxMeters':round(max(errors),1),'uncertaintyMeters':uncertainty,'uncertaintyMeaning':'사진 판독 보조 비교에 쓰는 참고 거리이며 검증된 오차 상한·신뢰구간이 아닙니다.','publicRoadConfirmed':False,'routeEligible':len(route['routingWaypoints'])==2,'routingWaypoints':route['routingWaypoints'],'note':'경찰 공개 지도의 빨간 선을 사진·슬라이드에서 판독해 좌표에 맞춘 참고 구간입니다. 공식 구간 좌표가 아니며 위치 오차·도로 중심선과의 차이가 있습니다. 실제 안내선은 별도로 조회한 TMAP 보행경로입니다.','calibrationNote':route.get('calibrationNote','수록 지도와 OSM 도로 교차점·부지 대표위치를 대조해 보정했습니다. 잔차는 통제점 맞춤값이며 실제 위치 정확도를 보장하지 않습니다.')}
    if auxiliary['coordinates']:
        props['sourceAuxiliaryGeometry']=auxiliary
        props['sourceAuxiliaryNote']='원본에 파란색으로 그려진 보조 선분입니다. 범례에 의미가 명시되지 않아 빨간 지정길 선과 합치지 않고 별도 보관합니다.'
    features.append({'type':'Feature','id':route['id'],'geometry':geometry,'properties':props})
    icons=[]
    for item in route['icons']:
        # Drawing-order duplicate symbols are not separate installed assets.
        icons=[old for old in icons if not (math.dist(old['pixel'],item['pixel'])<5 and old['facilityType'] in ['cctv','cctv-bell'] and item['facilityType'] in ['cctv','cctv-bell'])]
        icons.append(item)
    for index,item in enumerate(icons):
        fid=route['id']+'-symbol-'+str(index+1)
        names={'cctv-bell':'CCTV·비상벨 표기','cctv':'CCTV 표기 · 비상벨 없음','logo-projector':'로고젝터 표기','route-sign':'안심귀갓길 위치표지'}
        features.append({'type':'Feature','id':fid,'geometry':{'type':'Point','coordinates':unproject(transform(item['pixel']))},'properties':{**source,'id':fid,'routeId':route['id'],'name':route['name']+' · '+names[item['facilityType']],'featureType':'safe-return-reference-symbol','facilityType':item['facilityType'],'regionId':'seogu','geometryStatus':'image-interpreted','sourcePosition':'image-interpreted','coordinateAuthority':'image-georeferenced-not-official','sourceSlide':route['slide'],'uncertaintyMeters':uncertainty,'routeEligible':False,'operatingStatus':'not-verified','note':'경찰 지도에 그려진 기호의 판독 위치입니다. 실제 설치 좌표·현재 작동·시야·신고 연결·현재 조도를 확인한 자료가 아닙니다. 안내 경유점으로 자동 사용하지 않습니다.'}})
    report.append({'name':route['name'],'controls':len(errors),'rmseMeters':round(rmse,1),'maxResidualMeters':round(max(errors),1),'uncertaintyMeters':uncertainty,'segments':len(route['pixelLines']),'symbols':len(icons),'waypoints':len(route['routingWaypoints'])})
output={'type':'FeatureCollection','metadata':{**source,'alignmentSource':ALIGNMENT_SOURCE,'regionId':'seogu','geometryStatus':'image-interpreted','coordinateAuthority':'image-georeferenced-not-official','routeCount':len(data['routes']),'symbolCoverage':'편집 가능한 원본 슬라이드 기호를 판독한 부분 목록입니다. 배경 JPEG에 합쳐진 기호까지 모두 수집한 전체 시설 수가 아닙니다.','calibrationReport':report,'rebuildCommand':'python3 scripts/data/build-safe-return-image-routes.py','notes':['원본 슬라이드의 편집 가능한 제목 금호1·금호2·금호3·화정1·화정2·농성1을 기준으로 분류했습니다. 배경 이미지에 남은 이전 제목과 구분합니다.','금호3과 농성1의 벡터 빨간 선은 원본의 flipH·flipV·회전을 적용하여 복원했습니다.','사진 판독 구간은 공식 좌표·통행 가능·범죄 위험·안전 보장 판정이 아닙니다.','시설 기호 수·근접거리로 안전 점수를 만들지 않습니다.','OSM 도로 교차점은 도보 경유 후보의 지도상 근거이며 현재 현장 통행·보도·공사 여부는 별도 확인이 필요합니다.']},'features':features}
OUTPUT.parent.mkdir(parents=True,exist_ok=True);OUTPUT.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2));print('wrote',OUTPUT)
