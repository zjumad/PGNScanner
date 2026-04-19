import { Chessboard } from 'react-chessboard';

interface BoardViewerProps {
  fen: string;
  orientation?: 'white' | 'black';
}

export default function BoardViewer({ fen, orientation = 'white' }: BoardViewerProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: false,
          boardStyle: {
            borderRadius: '4px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          },
          darkSquareStyle: { backgroundColor: '#779952' },
          lightSquareStyle: { backgroundColor: '#edeed1' },
        }}
      />
    </div>
  );
}
