module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Vercel 환경변수에 GEMINI_API_KEY가 없습니다.' });
  }

  // 한국 표준시(KST) 기준 최근 3일 날짜 계산
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const formatDay = (offset) => {
    const d = new Date(nowKst.getTime() - offset * 24 * 60 * 60 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = days[d.getUTCDay()];
    const suffix = offset === 0 ? '오늘' : offset === 1 ? '어제' : '그제';
    return {
      date: `${yyyy}-${mm}-${dd}`,
      label: `${Number(mm)}월 ${Number(dd)}일 (${dayName} · ${suffix})`
    };
  };

  const recentDays = [formatDay(0), formatDay(1), formatDay(2)];
  const todayStr = recentDays[0].date;

  // XML 태그 파싱 헬퍼
  const extractItemsFromRss = (xmlText) => {
    const items = [];
    const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const rawItem of itemMatches.slice(0, 15)) {
      const titleMatch = rawItem.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
      const linkMatch = rawItem.match(/<link>(.*?)<\/link>/);
      const pubDateMatch = rawItem.match(/<pubDate>(.*?)<\/pubDate>/);
      const sourceMatch = rawItem.match(/<source[^>]*>(.*?)<\/source>/);

      const title = (titleMatch?.[1] || titleMatch?.[2] || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
      const link = (linkMatch?.[1] || '').trim();
      const pubDate = (pubDateMatch?.[1] || '').trim();
      const source = (sourceMatch?.[1] || '언론보도').trim();

      if (title) {
        items.push({ title, link, pubDate, source });
      }
    }
    return items;
  };

  try {
    // 1단계: Google 뉴스 공식 RSS에서 실시간 부산 재난/사건사고 기사 무료 수집 (API 제한 없음)
    const disasterRssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent('부산 기상특보 OR 부산 산불 OR 부산 도로통제 OR 부산 재난 when:3d')}&hl=ko&gl=KR&ceid=KR:ko`;
    const incidentRssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent('부산 화재 OR 부산 교통사고 OR 부산 경찰 OR 부산 추락 when:3d')}&hl=ko&gl=KR&ceid=KR:ko`;

    const [disRes, incRes] = await Promise.all([
      fetch(disasterRssUrl),
      fetch(incidentRssUrl)
    ]);

    const disXml = await disRes.text();
    const incXml = await incRes.text();

    const rawDisasters = extractItemsFromRss(disXml);
    const rawIncidents = extractItemsFromRss(incXml);

    // 2단계: 수집된 실시간 헤드라인을 Gemini에 전달하여 JSON 브리핑 데이터로 구조화 (google_search 도구 미사용 -> 429 회피)
    const prompt = `
오늘 날짜는 ${todayStr}입니다. 아래는 방금 Google 뉴스 RSS에서 수집한 최근 3일간 부산광역시 실시간 뉴스 목록입니다.
이 목록의 실제 기사들을 바탕으로 아래 JSON 구조에 맞춰 한국어 브리핑 데이터를 만들어줘.
반드시 순수 JSON 객체만 출력하고 마크다운 백틱(\`\`\`)은 쓰지 마.

[수집된 재난·특보·통제 후보 기사]
${JSON.stringify(rawDisasters, null, 2)}

[수집된 사건·사고 후보 기사]
${JSON.stringify(rawIncidents, null, 2)}

규칙:
- "disasters"에는 재해·재난·기상특보·산불예방·도로통제 관련 기사 4건을 채워줘. (후보가 부족하면 부산 기상·안전 안내를 포함해 4건 구성)
- "incidents"에는 화재·교통사고·치안·산업재해 등 사건·사고 기사 4건을 채워줘.
- 각 기사의 "date"는 "${recentDays[0].date}", "${recentDays[1].date}", "${recentDays[2].date}" 중 실제 보도일에 가장 가까운 날짜를 넣어줘.
- "sourceUrl"에는 후보 기사의 실제 link 값을 그대로 넣어줘.
- "summary"와 "content"는 기사 제목과 맥락을 바탕으로 시청자에게 브리핑하듯 자연스럽고 명확하게 2~4문장으로 작성해줘.

{
  "bannerHeadline": "오늘 부산 기상특보 및 재난·안전 핵심 요약 1줄",
  "bannerSubtext": "시민 안전 유의사항 1줄",
  "recentDays": ${JSON.stringify(recentDays)},
  "disasters": [
    {
      "id": "dis-1",
      "type": "disaster",
      "date": "${todayStr}",
      "dateLabel": "11월 16일 (오늘)",
      "severity": "주의",
      "category": "기상/안전",
      "district": "부산 전역 또는 해당 구·군",
      "title": "기사 제목",
      "summary": "2문장 핵심 요약",
      "source": "언론사명",
      "sourceUrl": "기사 원문 URL",
      "publishedAt": "MM월 DD일",
      "actionGuide": "시민 행동요령 1~2문장",
      "content": "상세 브리핑 본문 3~4문장"
    }
  ],
  "incidents": [
    {
      "id": "inc-1",
      "type": "incident",
      "date": "${todayStr}",
      "dateLabel": "11월 16일 (오늘)",
      "category": "화재 또는 교통사고 또는 치안 또는 산업재해",
      "district": "해당 구·군",
      "title": "기사 제목",
      "summary": "2문장 핵심 요약",
      "source": "언론사명",
      "sourceUrl": "기사 원문 URL",
      "publishedAt": "MM월 DD일",
      "status": "진행 상태",
      "content": "상세 브리핑 본문 3~4문장"
    }
  ]
}
`;

    // 사용 가능한 최신 모델 순서대로 일반 텍스트 생성 호출 (google_search 미사용)
    const modelsToTry = ['gemini-3.8-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
    let parsedResult = null;
    let lastErr = null;

    for (const modelName of modelsToTry) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      const data = await response.json();
      if (!response.ok) {
        lastErr = { modelName, status: response.status, detail: data };
        continue;
      }

      const rawText = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n').trim();
      const start = rawText.indexOf('{');
      const end = rawText.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        parsedResult = JSON.parse(rawText.slice(start, end + 1));
        parsedResult.usedModel = modelName;
        break;
      }
    }

    if (!parsedResult) {
      return res.status(500).json({
        error: 'Gemini 브리핑 변환 실패',
        lastErr,
        rssCollected: { disasters: rawDisasters.length, incidents: rawIncidents.length }
      });
    }

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');
    return res.status(200).json(parsedResult);
  } catch (error) {
    return res.status(500).json({
      error: '서버 처리 중 오류 발생',
      message: error.message
    });
  }
};