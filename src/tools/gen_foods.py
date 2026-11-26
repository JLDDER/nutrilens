"""Generates js/foods.js from tools/foodref/foodref.json. Run from src/: python3 tools/gen_foods.py

Flags per row (spec: 脂肪帳本 v9.2 §3.5, §3.3.2-7):
  asCooked   the measured value already contains its cooking or frying oil (炒, 炸, prepared dishes): no oil is added
             for the method the row was measured with.
  rowMethod  where that oil came from: stirfry | deepfry | panfry | none. none = a plain-cooked base or a finished
             product (white toast, dumplings, fried tofu bought ready-made).
  prefried   (asCooked + none only) the product was deep-fried or is oily as bought (炸豆皮, 油豆腐, 麵筋, 烤雞);
             false for steamed / boiled / baked products (水餃, 包子, 吐司): those still take oil when pan-fried again.
  pairKey    the same food cooked another way (高麗菜（燙）↔ 高麗菜（炒）), used when the final method disagrees with
             the row the model picked.
  group      coarse food group for the plausibility check (§3.7).
  includes   toppings a whole-dish row already contains (擔仔麵 includes 肉燥), so they are not added twice.
"""
import json, re, pathlib

d = json.load(open('tools/foodref/foodref.json'))

FRIED = re.compile(r'炸|唐揚|天婦羅|甜不辣|薯條|油條|洋芋片|鹽酥|可樂餅|春捲|油豆腐|豆皮（|炸豆皮|麵筋|甜甜圈')
STIRFRY = re.compile(r'炒(?!／煎)|涼拌|麻婆|糖醋|燴|金平|咖哩|丼料|燉肉|泡麵')
PANFRY = re.compile(r'煎餃|鍋貼|荷包蛋（加油|蚵仔煎|蔥油餅|餡餅|水煎包|韭菜盒子|玉子燒|大阪燒|漢堡排|棺材板')
# Rows measured without added oil although their name says 炒 / 煎 (八訂 焼き is dry-pan cooking).
DRY_COOKED = {'豬絞肉（炒）', '牛絞肉（炒）', '雞絞肉（炒／煎）', '荷包蛋（不加油）', '煎蛋（不加油）', '蘿蔔糕（未煎）'}
# Bases that are not oil-cooked, although TFND files them with prepared foods.
PLAIN_BASES = {'板豆腐', '嫩豆腐', '雞蛋豆腐', '豆干', '五香豆干', '黑豆干', '豆干絲', '百頁豆腐', '麵腸', '饅頭', '花捲', '熱狗', '豆腐皮'}
# Finished products that are steamed, boiled or baked (pan-frying them again adds oil).
NOT_PREFRIED = re.compile(r'水餃|餛飩|包|饅頭|花捲|吐司|麵包|可頌|餐包|飯糰|粽|米糕|粥|豆花|布丁|蛋糕|鬆餅|燒餅|小籠|燒賣|壽司|擔仔麵|肉羹|豬血糕|餅|銅鑼燒|蛋塔')
# Toppings: oil or fat added on top; never get cooking oil.
TOPPINGS = {'豬油', '芝麻醬（麻醬）', '炸醬', '肉燥', '油蔥酥', '沙拉醬（美乃滋）', '人造奶油（乳瑪琳）', '奶酥醬', '香油（白芝麻油）',
            '辣油（紅辣椒油）', '沙茶醬', '花生粉', '起司片'}
STEWED = {'親子丼料（不含飯）', '牛丼料（不含飯）', '馬鈴薯燉肉'}
INCLUDES = {'擔仔麵（含肉燥，不含湯）': ['肉燥'], '火腿蛋三明治': ['沙拉醬（美乃滋）']}

# Rows the keyword rules file under the wrong group (荷包蛋 by 包, 蘿蔔糕 by 蘿蔔, 木瓜牛奶 by 牛, 帶皮雞腿 as lean…), which
# skewed the no-oil fat bounds of §3.7 (starch up to 11.2 g, veg 2.3 g, lean meat 15.2 g). Found in the v14 review.
GROUP_FIX = {"炒粿仔條": "starch", "蚵仔煎（不含醬）": "mixed", "韭菜盒子": "starch", "油條": "starch", "天婦羅（甜不辣）": "starch", "豬血糕": "starch", "棺材板": "starch", "火腿蛋三明治": "mixed", "披薩（夏威夷）": "mixed", "蘿蔔糕（未煎）": "starch", "銅鑼燒": "starch", "布丁": "dairy", "冰淇淋（香草）": "dairy", "鳳梨酥": "starch", "荷包蛋（加油 1 小匙）": "egg", "荷包蛋（不加油）": "egg", "木瓜牛奶": "dairy", "火龍果（紅肉）": "fruit", "雞腿（帶皮，水煮）": "meat_fat", "雞腿（帶皮，烤／煎）": "meat_fat", "黃線狹鱈（炸，裹麵包粉）": "seafood", "茄子（炸，裹粉）": "veg", "牛蒡（煮）": "veg", "煎餃（日式）": "starch", "春捲（炸）": "starch", "糖醋肉（含配菜）": "mixed", "燴什錦／八寶菜": "mixed", "炸白肉魚排": "seafood", "漢堡排": "meat_fat", "雞肉咖哩（醬料部分）": "mixed", "豬肉咖哩（醬料部分）": "mixed", "親子丼料（不含飯）": "mixed", "牛丼料（不含飯）": "mixed", "馬鈴薯燉肉": "mixed", "大阪燒": "starch", "金平牛蒡": "veg"}

def group_of(n, src_code):
    if n in GROUP_FIX: return GROUP_FIX[n]
    if n in TOPPINGS: return 'topping'
    if re.search(r'飯|麵|粉|粥|粽|米糕|吐司|麵包|饅頭|花捲|餅|馬鈴薯|地瓜|芋頭|玉米|南瓜|可頌|餐包|蛋糕|鬆餅|洋芋片|薯條|飯糰|包|水餃|鍋貼|餛飩|燒賣|蛋塔|甜甜圈', n): return 'starch'
    if re.search(r'蛋', n): return 'egg'
    if re.search(r'豆腐|豆干|豆皮|豆漿|素肉|麵腸|麵筋|豆花|毛豆', n): return 'soy'
    if re.search(r'五花|里肌（帶脂|絞肉|腳|腸|肚|牛肩（帶脂|牛菲力|熱狗|叉燒|肉鬆|肉乾|醬肘子|鵝|鴨|茶鵝', n): return 'meat_fat'
    if re.search(r'雞|豬|牛|羊|肉', n): return 'meat_lean'
    if re.search(r'魚|鮭|鱈|鯛|鯖|鰆|秋刀|蝦|蟹|蛤|蜆|牡蠣|干貝|魷|章魚', n): return 'seafood'
    if re.search(r'奶|乳|優格|起司', n): return 'dairy'
    if re.search(r'果|蕉|梨|瓜|莓|橘|柳橙|芭樂|葡萄|鳳梨|芒果|荔枝|龍眼|釋迦|蓮霧|棗|桃|櫻桃|酪梨|文旦|楊桃|木瓜', n) and src_code[:1] == 'D': return 'fruit'
    if re.search(r'茶|咖啡|可樂|飲料|汁|冬瓜|米漿|拿鐵', n): return 'drink'
    if re.search(r'果|仁|瓜子|夏威夷|花生|腰果', n): return 'nut'
    return 'veg'

ALIAS = {'雞胸（去皮，水煮）': ['水煮雞胸', '水煮雞胸肉', '水煮雞胸肉片', '水煮雞胸片', '清蒸雞胸', '清蒸雞胸肉'],
         '鮪魚罐頭（水煮，瀝乾）': ['水煮鮪魚', '水浸鮪魚', '水煮鮪魚肉', '水浸鮪魚肉', '水煮鮪魚罐頭', '鮪魚罐頭（水煮）'],
         '白飯': ['米飯', '蓬萊米飯', '白米飯'], '糙米飯': ['五穀飯'], '茶葉蛋': [], '可樂': ['可口可樂'],
         '油麵／拉麵（煮）': ['油麵', '拉麵麵條', '陽春麵麵條'], '烏龍麵（煮）': ['烏龍麵'], '冬粉（煮）': ['冬粉'],
         '高麗菜（炒）': ['炒高麗菜', '清炒高麗菜'], '水煮蛋': ['白煮蛋'], '薯條': ['炸薯條'],
         '沙拉醬（美乃滋）': ['美乃滋', '沙拉醬'], '芝麻醬（麻醬）': ['麻醬', '芝麻醬'], '香油（白芝麻油）': ['香油', '麻油'],
         '辣油（紅辣椒油）': ['辣油'], '人造奶油（乳瑪琳）': ['乳瑪琳', '人造奶油'], '麵筋（油炸）': ['麵筋', '油麵筋'],
         '油豆腐': ['炸豆腐'], '炸豆皮': ['炸豆包', '豆包']}
# Everyday names the model writes without a foodKey (v14 review); findFoodFor also matches them.
for _k, _v in {"蔥油餅": ["蔥抓餅"], "白吐司": ["烤白吐司", "烤吐司", "吐司", "白吐司片", "烤白吐司片"], "全麥吐司": ["烤全麥吐司"], "荷包蛋（加油 1 小匙）": ["荷包蛋", "煎荷包蛋"], "荷包蛋（不加油）": ["乾煎荷包蛋", "無油荷包蛋"], "豆漿（含糖）": ["含糖豆漿", "甜豆漿"], "豆漿（無糖）": ["無糖豆漿"], "優格（全脂，原味）": ["無糖優格", "原味優格", "無糖全脂優格"], "奇異果": ["黃金奇異果", "綠奇異果"], "地瓜（烤，去皮）": ["烤地瓜", "烤番薯", "烤黃地瓜"], "玉米（煮）": ["水煮玉米", "玉米粒", "水煮甜玉米"], "雞腿（去皮，水煮）": ["去皮水煮雞腿", "水煮去皮雞腿"], "雞腿（去皮，烤／煎）": ["去皮烤雞腿", "去皮煎雞腿"], "高麗菜（燙）": ["燙高麗菜", "川燙高麗菜", "水煮高麗菜", "汆燙高麗菜"], "青江菜（燙）": ["燙青江菜", "川燙青江菜", "水煮青江菜"], "青江菜（炒）": ["炒青江菜", "清炒青江菜"], "菠菜（燙）": ["燙菠菜", "川燙菠菜", "水煮菠菜"], "菠菜（炒）": ["炒菠菜", "清炒菠菜"], "空心菜（燙）": ["燙空心菜", "川燙空心菜", "水煮空心菜"], "綠花椰（燙）": ["燙花椰菜", "燙綠花椰", "水煮花椰菜", "水煮綠花椰", "燙青花菜"], "綠花椰（炒）": ["炒花椰菜", "炒綠花椰", "清炒花椰菜", "炒青花菜"]}.items():
    ALIAS[_k] = list(dict.fromkeys(ALIAS.get(_k, []) + _v))

rows = []
for x in d:
    n = x['n']
    prepared = (x['s'] == 'TW' and x['code'][0] in 'RQ') or (x['s'] == 'JP' and x['code'].startswith('18'))
    if n in TOPPINGS:
        method, as_cooked = 'none', False
    elif n in DRY_COOKED or n in PLAIN_BASES:
        method, as_cooked = 'none', False
    elif FRIED.search(n):
        method, as_cooked = 'deepfry', True
    elif PANFRY.search(n):
        method, as_cooked = 'panfry', True
    elif STIRFRY.search(n):
        method, as_cooked = 'stirfry', True
    else:
        method, as_cooked = 'none', prepared
    if n in ('豆漿（含糖）', '米漿', '鹹豆漿（含油條）'): method, as_cooked = 'none', True
    # Simmered dishes (八訂 18030/18031/18036): finished, not stir-fried, so a plain vote must not drop the row.
    if n in STEWED: method, as_cooked = 'none', True
    # Oil-included finished products that are not fried in the pan by the eater: treat as products, not as a method row.
    if method == 'deepfry' and re.search(r'油豆腐|炸豆皮|麵筋|洋芋片|油條|甜甜圈|甜不辣', n): method = 'none'
    prefried = None
    if as_cooked and method == 'none':
        prefried = False if n in STEWED else not NOT_PREFRIED.search(n)
    src = {'TW': 'TFND', 'JP': 'MEXT', 'US': 'USDA'}[x['s']]
    src_name = {'TW': f"衛福部食品營養成分資料庫 {x['code']}", 'JP': f"日本食品標準成分表（八訂）{x['code']}",
                'US': f"USDA FoodData Central SR Legacy {x['code']}"}[x['s']]
    row = dict(id=x['id'], key=n, aliases=ALIAS.get(n, []), p=x['p'], c=x['c'], f=x['f'], asCooked=as_cooked, rowMethod=method,
               group=group_of(n, x['code']), src=src, srcName=src_name)
    if prefried is not None: row['prefried'] = prefried
    if n in INCLUDES: row['includes'] = INCLUDES[n]
    rows.append(row)

# pairKey: the same food (key without its （…） suffix) measured another way; a plain row pairs with the first cooked
# one and every cooked row with the plain one.
base = lambda k: re.sub(r'（[^）]*）$', '', k)
by_base = {}
for r in rows: by_base.setdefault(base(r['key']), []).append(r)
for group in by_base.values():
    if len(group) < 2: continue
    plain = next((r for r in group if not r['asCooked']), None)
    cooked = [r for r in group if r['asCooked'] and r['rowMethod'] != 'none']
    for r in cooked:
        if plain: r['pairKey'] = plain['key']
    if plain and cooked: plain['pairKey'] = cooked[0]['key']

body = ',\n'.join('  ' + json.dumps(r, ensure_ascii=False, separators=(', ', ': ')) for r in rows)
head = pathlib.Path('js/foods.js').read_text().split('const FOOD_TABLE')[0]
head = re.sub(r' \* Values are per 100 g of the edible part AS SERVED\.[\s\S]*?do not hand-edit values\.\n',
              ' * Values are per 100 g of the edible part AS SERVED.\n'
              ' *  - asCooked: true  → the measured value already contains its cooking/frying oil; rowMethod says from what\n'
              ' *    (stirfry / deepfry / panfry), or none for finished products (prefried: bought fried or oily).\n'
              ' *  - asCooked: false → a plain base; the app adds oil from the final cooking method (js/fat.js).\n'
              ' *  - pairKey: the same food cooked another way; group: food group for the plausibility check;\n'
              ' *    includes: toppings a whole-dish row already contains.\n'
              ' * Generated by tools/gen_foods.py from TFND (衛福部) and MEXT 八訂 data — do not hand-edit values.\n', head)
pathlib.Path('js/foods.js').write_text(head + 'const FOOD_TABLE = [\n' + body + '\n];\n')
print(len(rows), 'asCooked', sum(r['asCooked'] for r in rows), 'pairs', sum('pairKey' in r for r in rows))
