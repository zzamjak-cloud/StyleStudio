import { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../../lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * React Error Boundary 컴포넌트
 * 하위 컴포넌트에서 발생한 에러를 캐치하여 UI에 표시
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('❌ ErrorBoundary에서 에러 캐치:', error);
    logger.error('   - 에러 정보:', errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 p-8">
          <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-2xl">⚠️</span>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">오류가 발생했습니다</h2>
                <p className="text-gray-600 mt-1">애플리케이션에서 예기치 않은 오류가 발생했습니다.</p>
              </div>
            </div>

            {this.state.error && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">에러 메시지:</h3>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <code className="text-sm text-red-800 break-all">
                    {this.state.error.toString()}
                  </code>
                </div>
              </div>
            )}

            {this.state.errorInfo && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">스택 트레이스:</h3>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-64 overflow-y-auto">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                다시 시도
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                페이지 새로고침
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

