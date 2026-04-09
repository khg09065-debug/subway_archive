from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import numpy as np
from sqlalchemy import create_engine
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from math import radians, cos, sin, asin, sqrt
import os
from dotenv import load_dotenv

# .env 파일에 저장된 데이터베이스 접속 정보(HOST, USER, PASSWORD, NAME)를 로드합니다.
load_dotenv()

app = Flask(__name__)
CORS(app)

# --- [1. 환경 설정 및 DB 연결] ---
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASSWORD", "1234")
DB_NAME = os.getenv("DB_NAME", "coffee_store")

# SQLAlchemy를 사용하여 MySQL 데이터베이스에 연결하는 엔진을 생성합니다.
engine = create_engine(f'mysql+pymysql://{DB_USER}:{DB_PASS}@{DB_HOST}:3306/{DB_NAME}')

# 분석에 사용할 브랜드 분류 리스트입니다.
premium_brands = ['스타벅스', '투썸플레이스', '폴바셋', '할리스', '파스쿠찌', '공차', '디저트39']
budget_brands = ['메가커피', '빽다방', '컴포즈커피', '더벤티', '메머드커피', '이디야', '던킨도너츠', '하삼동커피']

# --- [2. 유틸리티 함수] ---
# 하버사인(Haversine) 공식을 사용하여 두 지점(위도, 경도) 사이의 직선 거리(km)를 계산합니다.
def haversine(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    return 6371 * 2 * asin(sqrt(a))

# 각 지하철역 주변 500m 이내의 카페 데이터를 분석하여 머신러닝용 지표를 생성합니다.
def get_station_features(station_row, stores_df):
    s_lat, s_lon = station_row['위도'], station_row['경도']
    # 연산 속도 향상을 위해 위도/경도 0.01도 범위 내 매장만 1차로 필터링합니다.
    nearby = stores_df[
        (stores_df['위도'].between(s_lat - 0.01, s_lat + 0.01)) & 
        (stores_df['경도'].between(s_lon - 0.01, s_lon + 0.01))
    ].copy()
    
    if nearby.empty: return pd.Series([0, 0.0, 0.0, 0])
    
    # 1차 필터링된 매장 중 실제 거리가 500m(0.5km) 이내인 매장을 선별합니다.
    nearby['dist'] = nearby.apply(lambda x: haversine(s_lon, s_lat, x['경도'], x['위도']), axis=1)
    in_500m = nearby[nearby['dist'] <= 0.5]
    
    total_count = len(in_500m)
    if total_count == 0: return pd.Series([0, 0.0, 0.0, 0])
    
    # 상권 특성 수치(프리미엄 비율, 가성비 비율, 브랜드 다양성)를 계산합니다.
    p_ratio = round(in_500m['브랜드명'].isin(premium_brands).sum() / total_count, 2)
    b_ratio = round(in_500m['브랜드명'].isin(budget_brands).sum() / total_count, 2)
    diversity = in_500m['브랜드명'].nunique()
    
    return pd.Series([total_count, p_ratio, b_ratio, diversity])

# --- [3. 전역 분석 데이터 초기화] ---
STATION_ANALYSIS_RESULTS = []
COFFEE_STORES_DF = pd.DataFrame()

# 서버 시작 시 데이터를 로드하고 머신러닝(K-Means) 분석을 수행하여 결과를 메모리에 올립니다.
def run_realtime_clustering():
    global STATION_ANALYSIS_RESULTS, COFFEE_STORES_DF
    print("🚀 [분석] 시스템 초기화 및 데이터 분석을 시작합니다...")
    
    # 1. MySQL에서 전체 카페 매장 데이터를 읽어옵니다.
    print("📂 [1/4] DB에서 매장 정보를 불러오는 중...")
    COFFEE_STORES_DF = pd.read_sql("SELECT 브랜드명, 매장명, 주소, 경도, 위도 FROM coffee_chain", engine)
    
    # 2. 정제된 지하철 역사 데이터를 읽어옵니다.
    print("📂 [2/4] CSV 역사 정보를 불러오는 중...")
    station_df = pd.read_csv('전체_역사정보_최종_정제_v47.csv')
    stations = station_df.dropna(subset=['위도', '경도']).copy()
    stations['총_승하차객수'] = stations['1월 승차이용객수'] + stations['1월 하차이용객수']

    # 3. 역별 상권 특성을 추출합니다.
    print("🔍 [3/4] 반경 500m 상권 지표 계산 중...")
    features = stations.apply(lambda x: get_station_features(x, COFFEE_STORES_DF), axis=1)
    features.columns = ['브랜드_밀도', '프리미엄_비율', '가성비_비율', '브랜드_다양성']
    final_df = pd.concat([stations, features], axis=1)

    # 4. K-Means 머신러닝 모델을 통해 상권 유형을 4개 클러스터로 분류합니다.
    print("🤖 [4/4] K-Means 머신러닝 상권 분류 실행 중...")
    target_cols = ['총_승하차객수', '브랜드_밀도', '프리미엄_비율', '가성비_비율', '브랜드_다양성']
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(final_df[target_cols])
    
    kmeans = KMeans(n_clusters=4, random_state=42, n_init=10)
    final_df['클러스터'] = kmeans.fit_predict(X_scaled)

    # 분석 결과를 프론트엔드에서 사용하기 좋은 형태(딕셔너리 리스트)로 저장합니다.
    STATION_ANALYSIS_RESULTS = final_df.fillna("").to_dict(orient='records')
    print("✅ [분석] 데이터 준비 완료.")

# 서버 실행 전 분석 프로세스 가동
run_realtime_clustering()

# --- [4. API 엔드포인트] ---
# 전체 역 정보 및 클러스터링 결과를 반환합니다.
@app.route('/api/stations')
def get_stations():
    return jsonify(STATION_ANALYSIS_RESULTS)

# 특정 브랜드가 입점한 역 목록과 해당 역 주변의 매장 상세 정보를 반환합니다.
@app.route('/api/brand-analysis')
def get_brand_analysis():
    brand = request.args.get('brand')
    if not brand: return jsonify([])
    
    # 요청된 브랜드의 매장 데이터만 필터링합니다.
    brand_stores = COFFEE_STORES_DF[COFFEE_STORES_DF['브랜드명'] == brand].copy()
    result = []
    
    for station in STATION_ANALYSIS_RESULTS:
        s_lat, s_lon = station['위도'], station['경도']
        # 하버사인 거리를 이용해 역 주변 500m 내 매장을 상세 검색합니다.
        nearby = brand_stores[
            (brand_stores['위도'].between(s_lat - 0.01, s_lat + 0.01)) & 
            (brand_stores['경도'].between(s_lon - 0.01, s_lon + 0.01))
        ].copy()
        
        if nearby.empty: continue
        
        nearby['dist'] = nearby.apply(lambda x: haversine(s_lon, s_lat, x['경도'], x['위도']), axis=1)
        in_500m = nearby[nearby['dist'] <= 0.5]
        
        if not in_500m.empty:
            # 매장 상세 정보(이름, 주소, 좌표)를 리스트에 담습니다.
            stores = in_500m.apply(lambda x: {
                "name": x['매장명'],
                "address": x['주소'],
                "lat": x['위도'],
                "lon": x['경도']
            }, axis=1).tolist()
            
            result.append({
                "station_name": station['역명'],
                "line": station['노선명'],
                "station_id": str(station['역번호']),
                "station_lat": station['위도'],
                "station_lon": station['경도'],
                "stores": stores
            })
            
    return jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)