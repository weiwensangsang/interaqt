/**
 * 计数器 API
 * GET /api/counter - 获取当前计数
 * POST /api/counter - 增加计数
 */

export async function onRequestGet(context) {
  const { env } = context;
  
  try {
    // 查询当前计数
    const result = await env.DB.prepare(
      "SELECT count FROM data WHERE id = 1"
    ).first();
    
    return Response.json({
      success: true,
      count: result?.count || 0
    });
  } catch (error) {
    console.error('获取计数失败:', error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function onRequestPost(context) {
  const { env } = context;
  
  try {
    // 增加计数（原子操作）
    await env.DB.prepare(
      "UPDATE data SET count = count + 1 WHERE id = 1"
    ).run();
    
    // 返回更新后的计数
    const result = await env.DB.prepare(
      "SELECT count FROM data WHERE id = 1"
    ).first();
    
    return Response.json({
      success: true,
      count: result?.count || 0
    });
  } catch (error) {
    console.error('更新计数失败:', error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// 处理 OPTIONS 请求（CORS）
export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
