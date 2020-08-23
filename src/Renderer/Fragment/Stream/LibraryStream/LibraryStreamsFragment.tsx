import React from 'react';
import {StreamEvent} from '../../../Event/StreamEvent';
import {IssueEvent} from '../../../Event/IssueEvent';
import {IssueRepo} from '../../../Repository/IssueRepo';
import {GARepo} from '../../../Repository/GARepo';
import {StreamRow} from '../StreamRow';
import {SideSectionTitle} from '../SideSectionTitle';
import {SideSection} from '../SideSection';
import {StreamIPC} from '../../../../IPC/StreamIPC';
import {StreamEntity} from '../../../Library/Type/StreamEntity';
import {StreamId, StreamRepo} from '../../../Repository/StreamRepo';

type Props = {
}

type State = {
  streams: StreamEntity[];
  selectedStream: StreamEntity;
}

export class LibraryStreamsFragment extends React.Component<Props, State> {
  state: State = {
    streams: [],
    selectedStream: null,
  };

  componentDidMount() {
    this.init();

    StreamEvent.onSelectLibraryFirstStream(this, () => this.init());
    StreamEvent.onSelectStream(this, (stream) => {
      const selectedStream = this.state.streams.find(s => s.id === stream.id);
      this.setState({selectedStream});
    });
    StreamEvent.onUpdateStreamIssues(this, () => this.loadStreams());
    StreamEvent.onReloadAllStreams(this, () => this.loadStreams());

    IssueEvent.onUpdateIssues(this, () => this.loadStreams());
    IssueEvent.onReadAllIssues(this, () => this.loadStreams());

    StreamIPC.onSelectLibraryStreamInbox(() => this.handleSelectStreamById(StreamId.inbox));
    StreamIPC.onSelectLibraryStreamUnread(() => this.handleSelectStreamById(StreamId.unread));
    StreamIPC.onSelectLibraryStreamOpen(() => this.handleSelectStreamById(StreamId.open));
    StreamIPC.onSelectLibraryStreamMark(() => this.handleSelectStreamById(StreamId.mark));
    StreamIPC.onSelectLibraryStreamArchived(() => this.handleSelectStreamById(StreamId.archived));
  }

  componentWillUnmount() {
    StreamEvent.offAll(this);
    IssueEvent.offAll(this);
  }

  private async init() {
    await this.loadStreams();
    const firstStream = this.state.streams[0];
    this.handleSelectStream(firstStream);
  }

  private async loadStreams() {
    const {error, streams} = await StreamRepo.getAllStreams(['library']);
    if (error) return console.error(error);
    this.setState({streams});
  }

  private handleSelectStream(stream: StreamEntity) {
    this.setState({selectedStream: stream});
    StreamEvent.emitSelectStream(stream);

    GARepo.eventLibraryStreamRead(stream.name);
  }

  private handleSelectStreamById(libraryStreamId: number) {
    const stream = this.state.streams.find(s => s.id === libraryStreamId);
    if (stream) this.handleSelectStream(stream);
  }

  private async handleReadAll(stream: StreamEntity) {
    if (confirm(`Would you like to mark "${stream.name}" all as read?`)) {
      const {error} = await IssueRepo.updateReadAll(null, stream.defaultFilter);
      if (error) return console.error(error);
      IssueEvent.emitReadAllIssues(stream.id);
      GARepo.eventLibraryStreamReadAll(stream.name);
    }
  }

  render() {
    return (
      <SideSection>
        <SideSectionTitle>LIBRARY</SideSectionTitle>
        {this.renderStreams()}
      </SideSection>
    );
  }

  private renderStreams() {
    return this.state.streams.map(stream => {
      return (
        <StreamRow
          stream={stream}
          selected={this.state.selectedStream?.id === stream.id}
          onSelect={stream => this.handleSelectStream(stream)}
          onReadAll={stream => this.handleReadAll(stream)}
          key={stream.id}
        />
      );
    });
  }
}