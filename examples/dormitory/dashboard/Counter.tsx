import { atom, RenderContext } from "axii";

export function Counter({}, { useEffect, createElement }: RenderContext) {
  const count = atom(0);
  const loading = atom(false);
  const error = atom<string | null>(null);

  // 判断是开发环境还是生产环境
  const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:8788'  // 本地开发时的 Functions 端口
    : '';  // 生产环境使用相对路径

  // 获取当前计数
  const fetchCount = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/counter`);
      const data = await response.json();
      if (data.success) {
        count(data.count);
      } else {
        error('获取计数失败');
      }
    } catch (err) {
      console.error('获取计数错误:', err);
      error('网络错误');
    }
  };

  // 增加计数
  const incrementCount = async () => {
    if (loading()) return;
    
    loading(true);
    error(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/counter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      if (data.success) {
        count(data.count);
      } else {
        error('更新计数失败');
      }
    } catch (err) {
      console.error('更新计数错误:', err);
      error('网络错误');
    } finally {
      loading(false);
    }
  };

  // 组件挂载时获取初始计数
  useEffect(() => {
    fetchCount();
  });

  const containerStyle = {
    position: 'fixed' as const,
    bottom: '30px',
    right: '30px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderRadius: '20px',
    padding: '20px 30px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '15px',
    minWidth: '200px',
    zIndex: 1000
  };

  const titleStyle = {
    fontSize: '14px',
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px'
  };

  const countStyle = {
    fontSize: '48px',
    fontWeight: '700',
    color: '#fff',
    lineHeight: '1',
    textShadow: '0 2px 4px rgba(0,0,0,0.2)'
  };

  const buttonStyle = {
    background: 'rgba(255,255,255,0.2)',
    border: '2px solid rgba(255,255,255,0.3)',
    borderRadius: '12px',
    padding: '12px 24px',
    color: '#fff',
    fontSize: '16px',
    fontWeight: '600',
    cursor: loading() ? 'not-allowed' : 'pointer',
    transition: 'all 0.3s ease',
    opacity: loading() ? 0.5 : 1,
    '&:hover': !loading() ? {
      background: 'rgba(255,255,255,0.3)',
      transform: 'translateY(-2px)',
      boxShadow: '0 5px 15px rgba(0,0,0,0.2)'
    } : {}
  };

  const errorStyle = {
    fontSize: '12px',
    color: '#ffcccc',
    marginTop: '5px'
  };

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>全球访问次数</div>
      <div style={countStyle}>{count}</div>
      <button 
        onClick={incrementCount}
        style={buttonStyle}
        disabled={loading()}
      >
        {() => loading() ? '更新中...' : '点击 +1'}
      </button>
      {() => error() && <div style={errorStyle}>{error()}</div>}
    </div>
  );
}
